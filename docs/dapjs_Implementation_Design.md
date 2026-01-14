# DAPJS Integration Design for STM32 Flashing

*Last updated: 2026-01-13*

## Overview

This document details the plan to use `dapjs` (a WebUSB -> CMSIS-DAP bridge) to flash STM32 microcontrollers using a standard debug probe (like a Raspberry Pi Pico running `debugprobe` firmware).

Since the standard `debugprobe` firmware does not support the high-level "drag-and-drop" (MSC) or standard DAPLink flash algorithms, we must implement the low-level flash controller operations (Unlock, Erase, Write) directly in JavaScript by manipulating the STM32 memory-mapped registers via DAP.

## Dependencies

- `dapjs`: Core library for CMSIS-DAP communication.
- `usb`: (Optional) Node.js support, but we are targeting WebUSB in the browser.

## Architecture

We will introduce two main classes:

1. **`DapLinkWrapper`**: Manages the WebUSB connection and `dapjs.CmsisDAP` instance.
2. **`Stm32DapFlasher`**: Uses `DapLinkWrapper` to execute the STM32-specific flashing sequence.

---

## STM32 Family Support

### Chip Identification via DBGMCU_IDCODE

The Cortex-M CPUID register (`0xE000ED00`) only identifies the ARM core variant (M0, M4, M7), not the specific STM32 part. For precise identification, we must read the **DBGMCU_IDCODE** register, which contains the device ID (DEV_ID) and revision (REV_ID).

| Family | DBGMCU_IDCODE Address | Example DEV_ID |
|--------|----------------------|----------------|
| Family | DBGMCU_IDCODE Address | Example DEV_ID |
|--------|----------------------|----------------|
| STM32F1xx | `0xE0042000` | `0x410` (MD), `0x414` (HD) |
| STM32F3xx | `0xE0042000` | `0x422` (F303xC), `0x446` (F303xE) |
| STM32F4xx | `0xE0042000` | `0x431` (F411), `0x413` (F405/F407) |
| STM32G4xx | `0xE0042000` | `0x468` (G431/G441), `0x469` (G47x/G48x) |
| STM32L4xx | `0xE0042000` | `0x415` (L43x), `0x462` (L45x/L46x) |
| STM32L0xx | `0x40015800` | `0x417` (L0x1), `0x425` (L0x2) |
| STM32WLxx | `0xE0042000` | `0x497` (WL55/WL54) |

```typescript
// chip detection
const DBGMCU_IDCODE_DEFAULT = 0xE0042000;
const DBGMCU_IDCODE_L0 = 0x40015800;

async function detectChip(dap: DapLinkWrapper): Promise<ChipInfo> {
    // try default address first
    let idcode = await dap.readWord(DBGMCU_IDCODE_DEFAULT);
    let devId = idcode & 0xFFF;
    
    // if zero or invalid, try L0 address
    if (devId === 0 || devId === 0xFFF) {
        idcode = await dap.readWord(DBGMCU_IDCODE_L0);
        devId = idcode & 0xFFF;
    }
    
    const revId = (idcode >> 16) & 0xFFFF;
    return lookupChipByDevId(devId, revId);
}
```

### Flash Register Definitions by Family

| Family | FLASH_BASE | KEYR Offset | SR Offset | CR Offset | SR_BSY Bit | Parallelism |
|--------|------------|-------------|-----------|-----------|------------|-------------|
| Family | FLASH_BASE | KEYR Offset | SR Offset | CR Offset | SR_BSY Bit | Parallelism |
|--------|------------|-------------|-----------|-----------|------------|-------------|
| STM32F1 | `0x40022000` | `0x04` | `0x0C` | `0x10` | bit 0 | 32-bit (Half-Word) |
| STM32F3 | `0x40022000` | `0x04` | `0x0C` | `0x10` | bit 0 | 32-bit (Half-Word) |
| STM32F4 | `0x40023C00` | `0x04` | `0x0C` | `0x10` | bit 16 | 32-bit |
| STM32G4 | `0x40022000` | `0x08` | `0x10` | `0x14` | bit 16 | 64-bit |
| STM32L4 | `0x40022000` | `0x08` | `0x10` | `0x14` | bit 16 | 64-bit |
| STM32L0 | `0x40022000` | `0x04` | `0x18` | `0x14` | bit 0 | 32-bit |
| STM32WL | `0x58004000` | `0x08` | `0x10` | `0x14` | bit 16 | 64-bit |

### Flash Memory Geometry

Different families have vastly different sector/page sizes:

| Family | Unit | Size | Notes |
|--------|------|------|-------|
| Family | Unit | Size | Notes |
|--------|------|------|-------|
| STM32F1 | Page | 1KB (MD) or 2KB (HD) | F103: MD < 256K, HD >= 256K |
| STM32F3 | Page | 2KB | uniform pages |
| STM32F4 | Sector | 16KB (0-3), 64KB (4), 128KB (5+) | variable sector sizes |
| STM32G4 | Page | 2KB or 4KB (dual-bank) | uniform pages |
| STM32L4 | Page | 2KB or 4KB (dual-bank) | uniform pages |
| STM32L0 | Page | 128 bytes | small pages, half-page (64B) writes |
| STM32WL | Page | 2KB | uniform pages |

```typescript
interface FlashGeometry {
    pageSize: number;        // smallest erasable unit in bytes
    pages?: number[];        // for uniform pages: total count
    sectors?: SectorInfo[];  // for variable sectors: array of {start, size}
}

interface SectorInfo {
    index: number;
    start: number;   // absolute address
    size: number;    // in bytes
}

// example: STM32F411 flash geometry
const STM32F411_GEOMETRY: FlashGeometry = {
    pageSize: 16384, // minimum sector is 16KB
    sectors: [
        { index: 0, start: 0x08000000, size: 16384 },
        { index: 1, start: 0x08004000, size: 16384 },
        { index: 2, start: 0x08008000, size: 16384 },
        { index: 3, start: 0x0800C000, size: 16384 },
        { index: 4, start: 0x08010000, size: 65536 },
        { index: 5, start: 0x08020000, size: 131072 },
        { index: 6, start: 0x08040000, size: 131072 },
        { index: 7, start: 0x08060000, size: 131072 },
    ]
};

// calculate which sectors need erasing for a given firmware
function getSectorsToErase(geometry: FlashGeometry, baseAddr: number, dataLen: number): number[] {
    const endAddr = baseAddr + dataLen;
    const sectorsToErase: number[] = [];
    
    if (geometry.sectors) {
        for (const sector of geometry.sectors) {
            const sectorEnd = sector.start + sector.size;
            // check if firmware overlaps this sector
            if (baseAddr < sectorEnd && endAddr > sector.start) {
                sectorsToErase.push(sector.index);
            }
        }
    }
    return sectorsToErase;
}
```

---

## Implementation Details

### 1. Connection (Hardware Service)

We need to request a WebUSB device with refined filters for known debug probes.

```typescript
// refined filters for specific debug probe products
const DAP_FILTERS = [
    { vendorId: 0x2E8A, productId: 0x000C }, // Pi Pico Debug Probe
    { vendorId: 0x0D28, productId: 0x0204 }, // ARM DAPLink (standard PID)
    { vendorId: 0x1FC9, productId: 0x0132 }, // LPC-Link2
    // fallback: generic CMSIS-DAP interface class
    { classCode: 0xFF, subclassCode: 0x00 }
];

// in hardwareService.ts
async function requestDapDevice(): Promise<USBDevice> {
    const device = await navigator.usb.requestDevice({ filters: DAP_FILTERS });
    return device;
}
```

### 2. DAP Wrapper (`DapLinkWrapper`)

This class wraps `dapjs` to expose memory read/write methods with batching support.

```typescript
import * as DAPjs from 'dapjs';

// cortex-m system control block registers
const SCB_AIRCR = 0xE000ED0C;
const AIRCR_VECTKEY = 0x05FA0000;
const AIRCR_SYSRESETREQ = 0x00000004;

export class DapLinkWrapper {
    private transport: DAPjs.WebUSB;
    private dap: DAPjs.CmsisDAP;

    constructor(device: USBDevice) {
        this.transport = new DAPjs.WebUSB(device);
        this.dap = new DAPjs.CmsisDAP(this.transport);
    }

    async connect(): Promise<void> {
        await this.dap.connect();
        // set SWD clock speed (10MHz typical)
        await this.dap.swjClock(10000000);
    }

    async writeWord(addr: number, data: number): Promise<void> {
        await this.dap.writeMem32(addr, [data]);
    }

    async readWord(addr: number): Promise<number> {
        const res = await this.dap.readMem32(addr, 1);
        return res[0];
    }

    // batched write for performance (up to 256 bytes per transaction recommended)
    async writeBlock(addr: number, data: Uint32Array): Promise<void> {
        const BATCH_SIZE = 64; // 64 words = 256 bytes
        for (let offset = 0; offset < data.length; offset += BATCH_SIZE) {
            const chunk = data.slice(offset, offset + BATCH_SIZE);
            await this.dap.writeMem32(addr + (offset * 4), chunk);
        }
    }

    // system reset via AIRCR register
    async systemReset(): Promise<void> {
        await this.writeWord(SCB_AIRCR, AIRCR_VECTKEY | AIRCR_SYSRESETREQ);
        // allow time for reset
        await new Promise(r => setTimeout(r, 100));
    }

    async disconnect(): Promise<void> {
        await this.dap.disconnect();
    }
}
```

### 3. STM32 Flash Logic (`Stm32DapFlasher`)

#### Family-Specific Constants

```typescript
interface FlashConfig {
    flashBase: number;
    keyrOffset: number;
    srOffset: number;
    crOffset: number;
    optkeyrOffset: number;
    optcrOffset: number;
    bsyBit: number;
    lockBit: number;
    pgBit: number;
    serBit: number;       // sector erase (F4) or page erase (G4)
    strtBit: number;
    snbShift: number;     // sector/page number bit position
    parallelism: 32 | 64; // write width in bits
    eraseTimeoutMs: number;
    writeTimeoutMs: number;
}

const FLASH_KEY1 = 0x45670123;
const FLASH_KEY2 = 0xCDEF89AB;
const OPT_KEY1 = 0x08192A3B;
const OPT_KEY2 = 0x4C5D6E7F;

const STM32F1_CONFIG: FlashConfig = {
    flashBase: 0x40022000,
    keyrOffset: 0x04,
    srOffset: 0x0C,
    crOffset: 0x10,
    optkeyrOffset: 0x08,
    optcrOffset: 0x1C, // OBR/WRPR
    bsyBit: 0,
    lockBit: 7,
    pgBit: 0,
    serBit: 1, // PER bit for page erase
    strtBit: 6,
    snbShift: 0, // No SNB, uses AR register for address
    parallelism: 16, // F1 supports 16-bit half-word programming
    eraseTimeoutMs: 1000,
    writeTimeoutMs: 100,
};

const STM32F3_CONFIG: FlashConfig = {
    ...STM32F1_CONFIG,
    // F3 shares F1 register layout largely, but verify density
    parallelism: 16,
};

const STM32F4_CONFIG: FlashConfig = {
    flashBase: 0x40023C00,
    keyrOffset: 0x04,
    srOffset: 0x0C,
    crOffset: 0x10,
    optkeyrOffset: 0x08,
    optcrOffset: 0x14,
    bsyBit: 16,
    lockBit: 31,
    pgBit: 0,
    serBit: 1,
    strtBit: 16,
    snbShift: 3,
    parallelism: 32,
    eraseTimeoutMs: 30000, // 128KB sector can take up to 20s
    writeTimeoutMs: 1000,
};

const STM32G4_CONFIG: FlashConfig = {
    flashBase: 0x40022000,
    keyrOffset: 0x08,
    srOffset: 0x10,
    crOffset: 0x14,
    optkeyrOffset: 0x0C,
    optcrOffset: 0x20,
    bsyBit: 16,
    lockBit: 31,
    pgBit: 0,
    serBit: 1, // PER bit for page erase
    strtBit: 16,
    snbShift: 3, // PNB bits
    parallelism: 64,
    eraseTimeoutMs: 5000,
    writeTimeoutMs: 1000,
};

const STM32L4_CONFIG: FlashConfig = {
    ...STM32G4_CONFIG,
    // L4 shares G4 register layout
};
```

#### Unlock Sequence

```typescript
async function unlockFlash(dap: DapLinkWrapper, config: FlashConfig): Promise<void> {
    const crAddr = config.flashBase + config.crOffset;
    const keyrAddr = config.flashBase + config.keyrOffset;
    
    const cr = await dap.readWord(crAddr);
    if (cr & (1 << config.lockBit)) {
        console.log("Unlocking flash...");
        await dap.writeWord(keyrAddr, FLASH_KEY1);
        await dap.writeWord(keyrAddr, FLASH_KEY2);
        
        // verify unlock
        const cr2 = await dap.readWord(crAddr);
        if (cr2 & (1 << config.lockBit)) {
            throw new Error("Flash unlock failed - check write protection");
        }
    }
}
```

#### Option Byte Handling (Write Protection)

Some devices ship with write protection enabled. We may need to unlock and clear it.

```typescript
async function unlockOptionBytes(dap: DapLinkWrapper, config: FlashConfig): Promise<void> {
    const optkeyrAddr = config.flashBase + config.optkeyrOffset;
    const optcrAddr = config.flashBase + config.optcrOffset;
    
    // unlock option bytes (requires flash to be unlocked first)
    await dap.writeWord(optkeyrAddr, OPT_KEY1);
    await dap.writeWord(optkeyrAddr, OPT_KEY2);
    
    // read current option register to check write protection
    const optcr = await dap.readWord(optcrAddr);
    console.log(`Option register: 0x${optcr.toString(16)}`);
    
    // note: modifying option bytes requires careful handling and may
    // trigger a system reset. only do this if write protection is blocking flash.
}

async function checkWriteProtection(dap: DapLinkWrapper, config: FlashConfig): Promise<boolean> {
    // after an erase/write, check SR for WRPERR (write protection error)
    const sr = await dap.readWord(config.flashBase + config.srOffset);
    const WRPERR_BIT = 4; // position varies by family
    return (sr & (1 << WRPERR_BIT)) !== 0;
}
```

#### Enhanced Wait for Busy (with Configurable Timeout)

```typescript
async function waitForBusy(
    dap: DapLinkWrapper, 
    config: FlashConfig, 
    timeoutMs: number
): Promise<void> {
    const srAddr = config.flashBase + config.srOffset;
    const bsyMask = 1 << config.bsyBit;
    const startTime = Date.now();
    
    while (Date.now() - startTime < timeoutMs) {
        const sr = await dap.readWord(srAddr);
        if (!(sr & bsyMask)) {
            // check for errors
            const errorMask = 0xF2; // common error bits (varies by family)
            if (sr & errorMask) {
                throw new Error(`Flash error: SR=0x${sr.toString(16)}`);
            }
            return;
        }
        await new Promise(r => setTimeout(r, 10));
    }
    throw new Error(`Flash operation timed out after ${timeoutMs}ms`);
}
```

#### Sector/Page Erase (with Extended Timeout)

```typescript
async function eraseSector(
    dap: DapLinkWrapper, 
    config: FlashConfig, 
    sectorIndex: number,
    sectorAddress?: number // F1/F3 requires AR register
): Promise<void> {
    const crAddr = config.flashBase + config.crOffset;
    
    // wait for any previous operation
    await waitForBusy(dap, config, config.eraseTimeoutMs);

    // F1/F3: Page Erase requires address in AR, not index in CR
    if (config.snbShift === 0 && sectorAddress !== undefined) {
         // Enable PER
         await dap.writeWord(crAddr, 1 << config.serBit);
         // Set Address in AR (offset 0x14 for F1)
         const arAddr = config.flashBase + 0x14;
         await dap.writeWord(arAddr, sectorAddress);
         // Start (STRT)
         await dap.writeWord(crAddr, (1 << config.serBit) | (1 << config.strtBit));
    } else {
        // F4/G4/L4/WL: Uses CR with SNB/PNB
        // set sector erase and sector number
        let crValue = (1 << config.serBit) | (sectorIndex << config.snbShift);
        await dap.writeWord(crAddr, crValue);
        
        // start erase
        await dap.writeWord(crAddr, crValue | (1 << config.strtBit));
    }
    
    // wait for completion (large sectors can take 20+ seconds)
    await waitForBusy(dap, config, config.eraseTimeoutMs);
    
    // clear erase bits
    await dap.writeWord(crAddr, 0);
}
```

#### Optimized Programming with Batched Writes

```typescript
async function programBlock(
    dap: DapLinkWrapper, 
    config: FlashConfig, 
    address: number, 
    data: Uint8Array,
    onProgress?: (percent: number) => void
): Promise<void> {
    const crAddr = config.flashBase + config.crOffset;
    
    // align data to parallelism requirement
    const alignedData = alignToParallelism(data, config.parallelism);
    
    // enable programming mode
    await dap.writeWord(crAddr, 1 << config.pgBit);

    if (config.parallelism === 64) {
        // STM32G4/L4/WL: write 64-bit double words
        await programDoubleWords(dap, config, address, alignedData, onProgress);
    } else {
        // STM32F4/L0: write 32-bit words with batching
        await programWords(dap, config, address, alignedData, onProgress);
    }

    // disable programming mode
    await dap.writeWord(crAddr, 0);
}

function alignToParallelism(data: Uint8Array, bits: number): Uint8Array {
    const alignment = bits / 8;
    const remainder = data.length % alignment;
    if (remainder === 0) return data;
    
    // pad with 0xFF (erased state)
    const padded = new Uint8Array(data.length + (alignment - remainder));
    padded.set(data);
    padded.fill(0xFF, data.length);
    return padded;
}

async function programWords(
    dap: DapLinkWrapper, 
    config: FlashConfig, 
    address: number, 
    data: Uint8Array,
    onProgress?: (percent: number) => void
): Promise<void> {
    const words = new Uint32Array(data.buffer, data.byteOffset, data.length / 4);
    const BATCH_SIZE = 64; // 256 bytes per batch
    
    for (let i = 0; i < words.length; i += BATCH_SIZE) {
        const chunk = words.slice(i, Math.min(i + BATCH_SIZE, words.length));
        await dap.writeBlock(address + (i * 4), chunk);
        await waitForBusy(dap, config, config.writeTimeoutMs);
        
        if (onProgress) {
            onProgress(Math.floor((i + chunk.length) / words.length * 100));
        }
    }
}

async function programDoubleWords(
    dap: DapLinkWrapper, 
    config: FlashConfig, 
    address: number, 
    data: Uint8Array,
    onProgress?: (percent: number) => void
): Promise<void> {
    // STM32G4/L4 requires writing two 32-bit words atomically for each 64-bit double word
    const words = new Uint32Array(data.buffer, data.byteOffset, data.length / 4);
    
    for (let i = 0; i < words.length; i += 2) {
        // write low word first, then high word
        await dap.writeWord(address + (i * 4), words[i]);
        await dap.writeWord(address + (i * 4) + 4, words[i + 1]);
        await waitForBusy(dap, config, config.writeTimeoutMs);
        
        if (onProgress && i % 64 === 0) {
            onProgress(Math.floor(i / words.length * 100));
        }
    }
}
```

### 4. Integration Strategy

1. **UI**: Add "Pi Pico / DAP" option in the connect dialog.
2. **Detection**: Read `DBGMCU_IDCODE` to identify the specific STM32 variant.
3. **Flasher**: The `flashSTM32DAP` function in `flasher.ts` will:
   - Initialize `DapLinkWrapper`.
   - Read DBGMCU_IDCODE -> Determine Family (F4, G4, L0, WL).
   - Select appropriate `FlashConfig` and `FlashGeometry`.
   - Check for write protection (warn user if present).
   - Unlock flash.
   - Calculate and erase needed sectors/pages.
   - Write firmware with batched transfers.
   - Verify (optional: read back and compare).
   - Reset via AIRCR `SYSRESETREQ`.

---

## Risk Mitigation

- **Bricking**: Interrupted flash operations can leave the device with no firmware. The bootloader (System Memory) is read-only, so users can always recover via DFU/UART, but we should ensure the DAP logic is robust (retries, extended timeouts).

- **Write Protection**: Some chips ship with RDP (Read-out Protection) or sector write protection enabled. We detect this via `WRPERR` in the status register and warn the user. Clearing write protection may require option byte modification, which triggers a mass erase.

- **Chip Variants**: Memory maps and register offsets differ significantly. We must detect the chip via `DBGMCU_IDCODE` rather than relying on user selection alone.

- **Performance**: Writing word-by-word via USB-DAP is slow (~50KB/s). Using batched `writeBlock` operations improves throughput to ~200KB/s. For large firmware (>256KB), expect 1-2 second flash times.

- **64-bit Alignment**: STM32G4/L4/WL require 8-byte aligned, 8-byte writes. Writing a single 32-bit word will cause a bus fault. The `alignToParallelism` helper ensures correct padding.
