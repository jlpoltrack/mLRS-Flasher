# Phase 3: Flashing Logic (Web Serial/DFU)

This phase implements the core flashing functionality for various chipsets (STM32, ESP32, ESP8266) directly from the browser using Web Serial and WebUSB.

## User Review Required

> [!IMPORTANT]
> Some flashing methods (like DFU) require WebUSB, while others use Web Serial. The user may need to grant permissions multiple times depending on the method.

> [!WARNING]
> STM32 UART (serial bootloader) requires specific hardware entry (e.g., boot button) and 8E1 parity, which Web Serial supports but some USB-TTL adapters might struggle with at high speeds.

## Proposed Changes

### [Web API Layer]

#### [NEW] [flasher.ts](file:///Users/jlp/Documents/mLRS-Flasher/web/src/api/flasher.ts)
A centralized orchestrator that selects the appropriate flashing strategy based on device metadata.
- `flash(port, firmwareData, options)`: Entry point.
- `flashESP(port, firmwareData, options)`: Using `esptool-js`.
- `flashSTM32DFU(usbDevice, firmwareData)`: Using `webdfu`.
- `flashSTM32UART(port, firmwareData)`: Implementation of ST bootloader protocol.

#### [MODIFY] [webSerialApi.ts](file:///Users/jlp/Documents/mLRS-Flasher/web/src/api/webSerialApi.ts)
Integrate the `flasher` into the main API object.
- Connect `flashFirmware` to `flasher.flash()`.

### [Components]

#### [MODIFY] [FirmwareFlasherPanel.tsx](file:///Users/jlp/Documents/mLRS-Flasher/web/src/components/FirmwareFlasherPanel.tsx)
Update the UI to handle flashing state and progress.
- Pass progress updates to the `Console` and progress bar.

---

## Verification Plan

### Automated Tests
- Mock `SerialPort` and `USBDevice` to verify protocol step sequencing in `flasher.ts`.

### Manual Verification
- Test `esptool-js` with an ESP32/ESP8266 device.
- Test `webdfu` with a Matek STM32 wing FC or similar.
- Test STM32 UART with an R9 receiver or similar.
- Verify progress reporting in the UI.
