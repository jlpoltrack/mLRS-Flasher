# Passthrough Flashing Optimizations

When flashing ESP devices via serial passthrough (e.g., INAV or ArduPilot), the connection can be sensitive to timing and buffer overruns due to the intermediate flight controller software and USB-to-UART translation. 

The following optimizations have been identified as critical for reliable operation in `flasher.ts`.

## 1. Block Size Reductions

Default `esptool-js` block sizes are often too large for the flight controller's passthrough buffers:

*   **ESP_RAM_BLOCK**: Default is 0x1800 (6KB). Reduced to **2048 bytes** (2KB).
*   **FLASH_WRITE_SIZE**: Default is 0x4000 (16KB). Reduced to **2048 bytes** (2KB).

*Observation: 1KB was very stable, 2KB is stable and faster, while 4KB was found to be unstable.*

## 2. Stub Loader Requirement

The **Stub Loader** should be used instead of the ROM loader for better reliability and features (like compression). However, the stub itself must be uploaded using the reduced `ESP_RAM_BLOCK` size to prevent it from hanging at the "Uploading stub" stage.

## 3. Compression

Compression (**compress: true**) must be enabled. While it was initially suspected as a cause of hangs, `esptool-js` currently lacks robust support for uncompressed writes in certain chip modes ("Yet to handle Non Compressed writes"). With the reduced block size, compressed writes are highly reliable.

## 4. Reset Strategy

For passthrough modes, `no_reset` is typically used because DTR/RTS signals are often not propagated through the flight controller's UART. The user must usually power up the hardware in bootloader mode manually.

---
*Last updated: 2026-01-16 (confirmed 2KB as stable limit)*
