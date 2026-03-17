# MSP Bootloader Implementation Guide

This document outlines the changes made to the mLRS project to support entering the STM32 system bootloader via the MSP protocol, and provides instructions for flashing software developers on how to trigger this mode.

## Changes Overview

### 1. Protocol Definition
**File**: `mLRS/Common/protocols/msp_protocol.h`

A new MSP command ID has been added to the protocol:
- **Command**: `MSP_REBOOT`
- **ID**: `68`

### 2. Receiver Implementation
**File**: `mLRS/CommonRx/msp_interface_rx.h`

The logic to handle this command has been implemented in the `tRxMsp` class:

- **Command Handling**: The firmware listens for `MSP_REBOOT` requests.
- **Validation**: The command is accepted if:
    - The payload length is **0**.
    - OR the payload length is **4** and the payload contains the magic number `1234321` (0x12D591).
- **Response**: Upon acceptance, the receiver sends a standard MSP response (V1 or V2 depending on the request) to acknowledge receipt.
- **Activation Delay**: After sending the response, a non-blocking 1-second timer (`reboot_activate_ms`) starts. This ensures the acknowledgment is fully transmitted before the device resets.
- **Action**: Once the timer expires, `BootLoaderInit()` is called to jump into the system bootloader.

---

## Guide for Flashing Software

To force an mLRS STM32 receiver into system bootloader mode using MSP, your software should perform the following steps:

### 1. Construct the Command
Construct an MSP request frame with the following properties:

- **Function ID**: `68` (0x44)
- **Payload**:
    - **Option A (Simple)**: 0 bytes.
    - **Option B (Magic)**: 4 bytes containing the integer `1234321` (0x0012D591) in Little Endian format (`91 D5 12 00`).
    *Note: Option B aligns with the MAVLink `REBOOT_SHUTDOWN_MAGIC` implementation.*

#### MSP V1 Example (Hex)
Requesting reboot with empty payload:
```
Header:  $ M <
Size:    00
Type:    44  (MSP_REBOOT)
CRC:     44  (00 ^ 44)
-----------------------
Bytes:   24 4D 3C 00 44 44
```

### 2. Send and Wait
1.  **Send**: Transmit the constructed frame to the receiver via the serial connection.
2.  **Listen**: Wait for a standard MSP response to confirm the device received the command.
    - If the firmware is working, it will reply immediately.
3.  **Wait**: Internal logic in the receiver waits **1000ms** after sending the response before switching modes. Your software should wait at least 1-1.5 seconds after receiving the ACK before attempting to communicate with the STM32 bootloader.

### 3. Connect to Bootloader
After the delay, the device effectively performs a system reset into bootloader mode. You can then proceed with standard STM32 bootloader protocols (e.g., sending `0x7F` to synchronize).
