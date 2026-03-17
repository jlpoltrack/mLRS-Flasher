# CLAUDE.md

This file provides guidance to Claude Code (claude.ai/code) when working with code in this repository.

## Project Overview

mLRS Flasher is a web-based PWA for flashing mLRS firmware to transmitter modules and receivers. It uses Web Serial API and WebUSB API to communicate with hardware directly from the browser, eliminating backend dependencies.

**Tech Stack:** React 19 + TypeScript + Vite

## Commands

All commands run from the `web/` directory:

```bash
npm run dev      # Start dev server with HMR (http://localhost:5173)
npm run build    # TypeScript check + production build
npm run lint     # ESLint
npm run preview  # Preview production build
```

## Architecture

### Directory Structure

```
web/src/
├── api/           # Core business logic
│   ├── webSerialApi.ts      # Main orchestration layer (public API)
│   ├── flasher.ts           # Flashing dispatcher (routes to ESP/STM32)
│   ├── githubApi.ts         # Firmware/version fetching from GitHub
│   ├── ardupilotPassthrough.ts # ArduPilot passthrough (MAVLink)
│   ├── inavPassthrough.ts   # INAV passthrough (MSP V2)
│   ├── stm32UartProtocol.ts # STM32 serial bootloader
│   ├── bufferedSerial.ts    # Buffered serial I/O with timeouts
│   ├── mspV2Protocol.ts     # MSP V2 packet framing/CRC
│   ├── hexParser.ts         # Intel HEX format parser
│   ├── metadata.ts          # Device database and firmware metadata
│   └── stlink/              # ST-Link SWD support (experimental)
├── components/    # React UI components
├── hooks/         # Custom React hooks
└── types/         # TypeScript type definitions
```

### Key Patterns

**Flashing Flow:** User selects firmware → `webSerialApi.ts` coordinates → `flasher.ts` dispatches to appropriate method (esptool-js for ESP32, webdfu for STM32 DFU, stm32UartProtocol for STM32 UART)

**Passthrough Protocols:** Flight controllers (ArduPilot/INAV) can route serial traffic to connected receivers. `ardupilotPassthrough.ts` uses MAVLink, `inavPassthrough.ts` uses MSP V2.

**State Management:** Global state in `App.tsx` via React hooks. `usePersistentState` hook for localStorage-backed preferences.

### Constants and Enums

Located in `src/constants.ts`:
- `TargetType`: rx, tx, txint
- `FlashMethod`: uart, dfu, esptool, stlink, ardupilot_passthrough, inav_passthrough, elrsbl
- `LogType`: info, error, warning, progress, success

### Critical Dependencies

- `esptool-js` - ESP32 flashing (Espressif maintained)
- `webdfu` - STM32 DFU flashing (Flipper Devices)
- `node-mavlink` - ArduPilot passthrough protocol

## Browser Compatibility

Web Serial and WebUSB APIs only work in Chromium browsers (Chrome, Edge, Opera). Firefox and Safari are not supported.

Windows users need WinUSB driver for STM32 DFU (ImpulseRC Driver Fixer or Zadig).

## Development Notes

- The `docs/` directory contains detailed architecture documentation
- Legacy Electron/Python code is archived in `z_archive/`
- Firmware metadata is fetched from GitHub at runtime
