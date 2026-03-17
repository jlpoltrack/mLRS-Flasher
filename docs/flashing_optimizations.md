# Passthrough Flashing Optimizations

When flashing ESP devices via serial passthrough (e.g., INAV or ArduPilot), the connection can be sensitive to timing and buffer overruns due to the intermediate flight controller software and USB-to-UART translation. 

The following settings are used in `flasher.ts` to ensure reliability.

## 1. Compression

Compression (**compress: true**) is enabled. While it was initially suspected as a cause of hangs, `esptool-js` currently lacks robust support for uncompressed writes in certain chip modes ("Yet to handle Non Compressed writes"). Compressed writes are highly reliable and faster.

## 2. Reset Strategy

For passthrough modes, `no_reset` is used because DTR/RTS signals are often not propagated through the flight controller's UART. The user must usually power up the hardware in bootloader mode manually (or the system reboots into it automatically via MSP/MAVLink commands before flashing).

---
*Last updated: 2026-01-19*