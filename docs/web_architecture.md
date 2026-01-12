# mLRS Web Flasher Architecture

## 1. Executive Summary
This document outlines the architecture for porting the mLRS Flasher from a hybrid Electron/Python desktop application to a **pure client-side Progressive Web App (PWA)**. 

The goal is to eliminate backend dependencies (Python, PyMavlink, STM32CubeProgrammer) to solve distribution, signing, and cross-platform issues, while retaining full functionality including ArduPilot Passthrough and Firmware Flashing.

## 2. Technology Stack

### Core Framework
- **Frontend**: **React + Vite** (Recommended)
    - **Pros**: Fast development (HMR), huge ecosystem, efficient state management (crucial for flashing progress/logs).
    - **Cons**: Build step required (standard nowadays).
    - **Opinion**: **Strongly Recommended**. Managing the complex state of a flashing process (connection status, progress bars, error handling, logs) in vanilla JS becomes unmaintainable quickly. React's component model is perfect for this. Use **TypeScript** to ensure binary data handling is safe.
- **Styling**: **TailwindCSS**
    - **Opinion**: Recommended for rapid UI iteration, but if you prefer standard CSS Modules for cleaner markup, that is also a valid choice. Using a component library like **shadcn/ui** (built on Tailwind) would give the app a premium feel instantly.

### Frontend Reusability
The existing Electron frontend is built with React and Vite, making it **highly reusable** (approx. 80-90% of code).

- **Reusable (Keep)**:
    - All UI Components (`Navigation`, `Console`, `UpdateBanner`, `FirmwareFlasherPanel`).
    - CSS styling and assets.
    - Global state management in `App.jsx` (logs, version lists, device lists).
- **Rewrite (Replace)**:
    - `preload.cjs`: The IPC bridge (`window.api`) must be replaced with a pure JS equivalent.
    - `window.api.flash()`: Instead of triggering a backend process, it will now instantiate `esptool-js` or `webdfu`.
    - `window.api.listVersions()`: Will use direct `fetch` calls to the GitHub API from the browser.

### Connectivity APIs
- **Web Serial API**: Used for standard COM port communication (replacing `pyserial`).
- **WebUSB API**: Used for direct DFU flashing (replacing `libusb`/drivers).

### Critical Libraries
| Component | Existing (Python) | New (JavaScript) | Status |
| :--- | :--- | :--- | :--- |
| **ESP32 Flashing** | `esptool.py` | **`esptool-js`** | Maintained by Espressif. |
| **STM32 Flashing** | `STM32CubeProgrammer` / `dfu-util` | **`webdfu`** | Maintained by Flipper Devices. |
| **MAVLink (Passthrough)** | `pymavlink` | **`node-mavlink`** | **Recommended**. Maintained by ArduPilot. Modern TypeScript support means you get type-safe MAVLink messages (e.g., `msg.param_id` is auto-completed), which prevents bugs. |
### Utility Components
- **Intel Hex Parser**: Needed for STM32 firmware (often distributed as `.hex`). Use a library like `intel-hex.js`.
- **IndexedDB / LocalForage**: For caching firmware binaries locally, enabling offline flashing after initial load.
- **GitHub API Wrapper**: To fetch versions and files directly from the repository, handling CORS via proxy if necessary (though GitHub raw files usually support it).

## 3. Core Workflows

### A. ArduPilot Passthrough (`apInitPassthru`)
*Current Logic*: Python script opens COM port, sends specific MAVLink messages to reconfigure internal routing parameters, then reboots.
*New Logic*:
1.  **Select Port**: User requests port via `navigator.serial.requestPort()`.
2.  **MAVLink Connection**: JS app establishes serial stream (approx 57600 baud).
3.  **State Machine**:
    *   Send `HEARTBEAT` until discovered.
    *   Send `PARAM_SET` for `SERIAL_PASS` and `SERIAL_PROTOCOL`.
    *   Monitor `MAV_CMD_PREFLIGHT_REBOOT_SHUTDOWN`.
4.  **Result**: Flight Controller reboots, and the same COM port (or a new muxed one) is now a transparent tunnel to the mLRS receiver.

### B. Flashing ESP32 (TX/RX)
*Current Logic*: Call `esptool.py` subprocess.
*New Logic*:
1.  **Connect**: Use `esptool-js` to attach to the Passthrough COM port or direct USB UART.
2.  **Sync**: Library handles the bootloader sync sequence (RTS/DTR toggling).
3.  **Flash**: Stream firmware binary directly from browser memory to device flash.

### C. Flashing STM32 (TX/RX)
*Current Logic*: Call `STM32CubeProgrammer` (CLI).
*New Logic*:
1.  **Mode Switch**: Device must be in **DFU Bootloader** mode.
    *   *Note*: If `apInitPassthru` successfully reboots the receiver into bootloader, it may appear as a DFU device (if USB) or remain on UART (if Serial).
    *   **Logic Branch**: 
        *   If **Serial Bootloader** (UART): Use a JS implementation of the STM32 serial protocol (e.g. `stm32-flash-js`).
        *   If **USB DFU** (Direct USB): Use `webdfu` to connect to the specific VendorID/ProductID of the STM32 bootloader.
2.  **Flash**: Send `DFU_DNLOAD` commands to write firmware.

## 4. Implementation Strategy

### Phase 1: Prototype Connectivity
- Create a minimal React app.
- Implement "Connect" button using Web Serial.
- Verify ability to send/receive raw bytes to a Flight Controller.

### Phase 2: MAVLink Port
-  integrate `node-mavlink` (or lightweight alternative).
-  Replicate the exact message sequence from `apInitPassthru.py`.
-  Verify valid passthrough activation.

### Phase 3: Flashing Integration
- Integrate `esptool-js` for ESP32 targets (easiest win).
- Integrate `webdfu` for STM32 DFU targets.

## 5. Challenges & Mitigations

| Challenge | Impact | Mitigation |
| :--- | :--- | :--- |
| **Windows Drivers** | WebUSB requires WinUSB driver, but STM32 DFU defaults to proprietary ST driver. | **This is the biggest hurdle.** <br> **Option A (Best UX)**: Recommend **ImpulseRC Driver Fixer**. It's a one-click standalone tool popular in the FPV community that auto-fixes the driver. Simpler than Zadig. <br> **Option B**: Zadig (Manual selection). <br> *Note*: We cannot fix this in software because the STM32 ROM bootloader is "burnt in" silicon and lacks the "WCID" descriptors to tell Windows to auto-load WinUSB. |
| **Browser Support** | Web Serial/WebUSB only works in Chromium (Chrome, Edge, Opera). | Feature detection at startup. Show "Please use Chrome or Edge" on Firefox/Safari. |
| **SWD Flashing** | STLink support is weak/complex in web. | **Deprecate SWD** for the web version. Focus exclusively on Serial (UART) and DFU methods. |
