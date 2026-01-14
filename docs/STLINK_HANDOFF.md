# ST-Link TypeScript Implementation - Handoff Document

**Date:** 2026-01-14  
**Status:** Phase 3 Complete (Full Integration)  
**Repository:** mLRS-Flasher

---

## Overview

This document covers the implementation of ST-Link USB communication in TypeScript/JavaScript for browser-based SWD flashing via WebUSB. All phases are now complete, and ST-Link flashing is fully integrated into the mLRS Flasher web application.

### Target Hardware
- **ST-Link Programmers:** V1, V2, V2-1, V3 (all versions supported)
- **Target MCUs:** STM32F103, STM32G4, STM32L4, STM32F3, STM32WLE5

---

## Completed Work

### Phase 1: Core USB Layer (Complete)
*   Implemented low-level WebUSB communication for ST-Link V2 and V3.
*   Added support for SWD mode entry, chip detection, and memory/register access.
*   Created chip database for F1, F3, G4, L4, and WL families.

### Phase 2: Flash Operations (Complete)
*   **Unified Driver Architecture:** Configurable driver handling different register layouts and programming widths (16/32/64-bit).
*   **Family Support:**
    *   **F1/F3:** Half-word/Word programming + AR-based erase.
    *   **L4/G4/WL:** Double-word programming + PNB-based erase.
*   **Robust Reset:** Multi-stage reset (Software AIRCR -> Verify -> Hardware NRST fallback).
*   **Optimization:** 4KB verification chunks for high-speed readback.

### Phase 3: Full Integration (Complete)
*   **Hook (`useStlinkDevices.ts`):** Managed WebUSB device lifecycle and selection.
*   **UI (`FirmwareFlasherPanel.tsx`):** Replaced static "External Flash" message with an active ST-Link selection and flashing interface.
*   **Orchestration (`flasher.ts` & `webSerialApi.ts`):** Routed main flashing flow to `flashSTM32SWD` when ST-Link method is selected.
*   **HEX Support:** Fully supports both `.bin` and `.hex` firmware formats with automatic gap padding.

---

## Architecture

```
web/src/
├── api/
│   ├── flasher.ts            # Entry point for SWD flashing logic
│   ├── hardwareService.ts    # USB device naming and enumeration
│   └── stlink/               # Core driver logic
│       ├── chipDatabase.ts   # Chip-specific flash configurations
│       ├── flashOperations.ts# Unlock/Erase/Program/Verify/Reset
│       ├── stlinkDevice.ts   # High-level command interface
│       └── stlinkUsb.ts      # Low-level WebUSB transport
└── hooks/
    └── useStlinkDevices.ts   # React hook for UI integration
```

---

## How to Flash via ST-Link

1.  Connect your ST-Link V2 or V3 programmer to your computer and the target MCU SWD pins.
2.  Open the mLRS Flasher web app.
3.  Select an STM32-based device (e.g., a Receiver or Tx Module).
4.  Change the **Flash Method** to **"STLink (SWD)"**.
5.  Click **"Add Device"** to authorize your ST-Link programmer via the browser picker.
6.  Once selected, click **"Flash"**.
7.  The application will automatically Connect, Detect Chip, Erase, Program, Verify, and Reset the target.

---

## Future Work (Phase 4)

- **Firmware Update:** Support updating the ST-Link's own firmware (complex, requires protocol analysis).
- **Serial Wire Output (SWO):** Support real-time tracing/logging over SWD.
- **Additional Families:** Add support for STM32H7 or STM32F4 (requires different flash controller logic).

---

## References

- [stlink-org/stlink](https://github.com/stlink-org/stlink) - Reference C implementation
- [STM32 Programming Manuals](https://www.st.com/) - PM0075 (F1), PM0214 (F3), PM0435 (L4), RM0453 (WL)
