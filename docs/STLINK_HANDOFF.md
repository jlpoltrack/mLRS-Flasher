# ST-Link TypeScript Implementation - Handoff Document

**Date:** 2026-01-14  
**Status:** Phase 1 Complete (Core USB Layer)  
**Repository:** mLRS-Flasher

---

## Overview

This document covers the implementation of ST-Link USB communication in TypeScript/JavaScript for browser-based SWD flashing via WebUSB. The goal is to enable flashing STM32 microcontrollers directly from the web application using ST-Link programmers.

### Target Hardware
- **ST-Link Programmers:** V1, V2, V2-1, V3 (all versions supported)
- **Target MCUs:** STM32F103, STM32G4, STM32L4, STM32F3, STM32WLE5

### Reference Implementation
Based on [stlink-org/stlink](https://github.com/stlink-org/stlink) C library.

---

## Completed Work (Phase 1)

### Files Created

All new files are in `web/src/api/stlink/`:

| File | Description |
|------|-------------|
| `index.ts` | Public API exports |
| `stlinkCommands.ts` | USB protocol command constants (ported from `stlink_cmd.h`) |
| `types.ts` | TypeScript interfaces: `StlinkVersion`, `ChipInfo`, `TargetState`, etc. |
| `stlinkUsb.ts` | Low-level WebUSB communication class |
| `stlinkDevice.ts` | High-level device interface (connect, halt, run, reset, memory access) |
| `chipDatabase.ts` | Chip definitions for F1, F3, G4, L4, WLE5 families |

### Test Page

New SWD test page for step-by-step validation:

| File | Description |
|------|-------------|
| `web/src/components/SwdTest.tsx` | Test page component |
| `web/src/components/swdTest.css` | Test page styles |

Navigation and App updated to include "SWD Test" tab.

---

## Architecture

```
web/src/api/stlink/
├── index.ts              # public exports
├── stlinkCommands.ts     # command protocol constants
├── stlinkDevice.ts       # high-level device interface
├── stlinkUsb.ts          # webusb communication layer
├── chipDatabase.ts       # chip definitions and lookup
└── types.ts              # typescript interfaces
```

### Key Classes

**StlinkUsb** - Low-level WebUSB communication:
- `open()` / `close()` - USB device connection
- `sendCommand(cmd, rxLen)` - Send command, receive response
- `getVersion()` - Get ST-Link version/capabilities
- `getCurrentMode()` - Get current operating mode
- `getTargetVoltage()` - Read target voltage

**StlinkDevice** - High-level interface:
- `connect()` / `disconnect()` - Full connection with SWD mode entry
- `detectChip()` - Read chip ID and lookup in database
- `halt()` / `run()` / `reset()` - CPU control
- `getStatus()` - Get running/halted state
- `readMem32()` / `writeMem32()` - Memory access
- `readDebugReg()` / `writeDebugReg()` - Debug register access

---

## Chip Database

Definitions for the target MCU families:

| Chip ID | Device Type | Flash Type | Page Size |
|---------|------------|------------|-----------|
| 0x410 | STM32F1xx_MD | F0_F1_F3 | 1KB |
| 0x414 | STM32F1xx_HD | F0_F1_F3 | 2KB |
| 0x422 | STM32F302_F303_358 | F0_F1_F3 | 2KB |
| 0x469 | STM32G47x_G48x | G4 | 2KB |
| 0x468 | STM32G43x_G44x | G4 | 2KB |
| 0x415 | STM32L47x_L48x | L4 | 2KB |
| 0x497 | STM32WLEx | WB_WL | 2KB |

Additional L4 variants (L41x, L42x, L43x, L44x, L45x, L46x) also included.

---

## How to Test

1. Run development server:
   ```bash
   cd web
   npm run dev
   ```

2. Open http://localhost:5173/mLRS-Flasher/

3. Navigate to **"SWD Test"** tab (wrench icon)

4. Connect ST-Link V3 to computer and F103 target

5. Click **"Select Device"** to pair via WebUSB

6. Click **"Connect"** to:
   - Open USB connection
   - Enter SWD mode
   - Detect chip
   - Read flash size and voltage

7. Test buttons:
   - **Halt** - Stop CPU
   - **Run** - Resume CPU
   - **Reset** - Reset target
   - **Read Flash** - Read first 64 bytes at 0x08000000

---

## Remaining Work

### Phase 2: Flash Operations (Next)

Create `flashOperations.ts` with:

- `unlockFlash()` / `lockFlash()` - Flash access control
- `isFlashBusy()` / `waitFlashBusy()` - Status polling
- `clearFlashErrors()` - Error handling
- `erasePage(addr)` - Single page erase
- `eraseSection(addr, size)` - Section erase
- `eraseMass()` - Full chip erase
- `programFlash(addr, data, onProgress)` - Flash programming
- `verifyFlash(addr, data)` - Verification

Flash type-specific implementations needed for:
- **F0_F1_F3:** Simple half-word programming (easiest)
- **G4:** 72-bit wide, dual bank
- **L4:** 72-bit wide, dual bank
- **WB_WL:** Similar to L4

### Phase 3: Integration

- Create `StlinkFlasher` class for web app integration
- Add `flashSTM32SWD()` function to `flasher.ts`
- UI integration in `FirmwareFlasherPanel.tsx`

---

## Key Constants

### ST-Link USB IDs

```typescript
STLINK_VID = 0x0483

// V2
STLINK_V2_PID = 0x3748
STLINK_V2_NUCLEO_PID = 0x374b

// V3
STLINK_V3E_PID = 0x374e
STLINK_V3S_PID = 0x374f
STLINK_V3_2VCP_PID = 0x3753
```

### Flash Registers (for Phase 2)

```typescript
// F1 flash registers
FLASH_BASE_F1 = 0x40022000
FLASH_KEYR = 0x04
FLASH_SR = 0x0C
FLASH_CR = 0x10
FLASH_AR = 0x14

// Unlock keys
FLASH_KEY1 = 0x45670123
FLASH_KEY2 = 0xCDEF89AB
```

### Chip ID Locations

```typescript
CORTEXM_DBGMCU_IDCODE = 0xe0044000    // most STM32
CORTEXM_DBGMCU_IDCODE_F1 = 0xe0042000 // F1, F3
```

---

## Notes

1. **TypeScript strictness:** Project uses `erasableSyntaxOnly` so enums are not allowed. Use const objects with type unions instead.

2. **WebUSB BufferSource:** When calling `transferOut`, must create explicit ArrayBuffer copy to avoid SharedArrayBuffer type issues.

3. **ST-Link V3:** Uses different version command (`0xFB` instead of `0xF1`) and different response format.

4. **SWD frequency:** V2 supports frequency setting via `SWD_SET_FREQ` command. Default is 950kHz.

---

## References

- [stlink-org/stlink](https://github.com/stlink-org/stlink) - Reference C implementation
- [stlink_cmd.h](https://github.com/stlink-org/stlink/blob/testing/inc/stlink_cmd.h) - Command definitions
- [usb.c](https://github.com/stlink-org/stlink/blob/testing/src/stlink-lib/usb.c) - USB protocol implementation
- [config/chips/](https://github.com/stlink-org/stlink/tree/testing/config/chips) - Chip definition files
