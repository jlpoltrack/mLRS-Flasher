# ST-Link TypeScript Implementation - Handoff Document

**Date:** 2026-01-14  
**Status:** Phase 2 Complete (Flash Operations)  
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

## Completed Work

### Phase 1: Core USB Layer (Complete)

All new files are in `web/src/api/stlink/`:

| File | Description |
|------|-------------|
| `index.ts` | Public API exports |
| `stlinkCommands.ts` | USB protocol command constants (ported from `stlink_cmd.h`) |
| `types.ts` | TypeScript interfaces: `StlinkVersion`, `ChipInfo`, `TargetState`, etc. |
| `stlinkUsb.ts` | Low-level WebUSB communication class |
| `stlinkDevice.ts` | High-level device interface (connect, halt, run, reset, memory access) |
| `chipDatabase.ts` | Chip definitions for F1, F3, G4, L4, WLE5 families |

### Phase 2: Flash Operations (Complete)

| File | Description |
|------|-------------|
| `flashOperations.ts` | Unified flash driver logic (unlock, erase, program, verify) |

**Key Achievements:**
- **Unified Driver Architecture:** Implemented a configuration-based driver that handles register offset differences and programming widths across families.
- **STM32F1/F3 Support:** Implemented 16-bit/32-bit programming and AR-based page erasing.
- **STM32L4/G4/WL Support:** Implemented 64-bit double-word programming and CR-PNB-based page erasing.
- **Robust Reset:** Implemented a multi-stage reset strategy (Software AIRCR -> Verify -> Hardware NRST pulse) to ensure reliable resetting of stubborn targets (validated on L4).
- **Validation:**
  - ✅ **STM32F1:** Verified 16-bit writes.
  - ✅ **STM32L4:** Verified 64-bit writes and Reset logic.
  - ✅ **STM32WLE5:** Verified correct Flash Register offsets (0x14/0x10).
  - ⏳ **STM32G4/F3:** Covered by shared driver architecture.

**Optimizations:**
- Increased verification chunk size to 4KB (from 256B) to maximize USB bandwidth.

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
├── flashOperations.ts    # flash programming logic
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
- `writeMem16()` - 16-bit memory access (required for F1 flash)
- `readDebugReg()` / `writeDebugReg()` - Debug register access

**FlashOperations** - High-level flash controller:
- `flashFirmware()` - Orchestrates full unlock-erase-program-verify-reset cycle.
- `programFlash()` - Handles 16/32/64-bit writes based on chip config.
- `erasePages()` - Handles AR vs CR_PNB erase methods.

---

## Remaining Work

### Phase 3: Integration (Next)

The final step is to integrate the ST-Link logic into the main application flow.

- Create `StlinkFlasher` class that implements the existing `FlasherInterface` (if applicable) or matches the pattern used by `SerialFlasher` / `DFUFlasher`.
- Update `web/src/api/flasher.ts` to export an `flashSTM32SWD` function.
- Update `FirmwareFlasherPanel.tsx` to:
  - Add "ST-Link" as a connection method option.
  - Handle ST-Link device selection and connection state.
  - Call the SWD flashing logic when selected.

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

### Flash Registers (Offsets vary by family)

- **F1/F3:** CR=0x10, SR=0x0C, AR=0x14
- **L4/G4/WL:** CR=0x14, SR=0x10

---

## Notes

1. **TypeScript strictness:** Project uses `erasableSyntaxOnly` so enums are not allowed. Use const objects with type unions instead.
2. **WebUSB BufferSource:** When calling `transferOut`, must create explicit ArrayBuffer copy to avoid SharedArrayBuffer type issues.
3. **ST-Link V3:** Uses different version command (`0xFB` instead of `0xF1`) and different response format.
4. **F1 Flashing:** STM32F1 requires 16-bit (half-word) write access.
5. **L4/WL Reset:** Requires AIRCR software reset followed by NRST pulse fallback.

---

## References

- [stlink-org/stlink](https://github.com/stlink-org/stlink) - Reference C implementation
- [stlink_cmd.h](https://github.com/stlink-org/stlink/blob/testing/inc/stlink_cmd.h) - Command definitions
- [usb.c](https://github.com/stlink-org/stlink/blob/testing/src/stlink-lib/usb.c) - USB protocol implementation
- [config/chips/](https://github.com/stlink-org/stlink/tree/testing/config/chips) - Chip definition files
