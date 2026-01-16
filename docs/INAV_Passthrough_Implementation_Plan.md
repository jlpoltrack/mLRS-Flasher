# INAV Passthrough Implementation Plan

## Goal Description
Enable flashing of receivers connected to a Betaflight or INAV Flight Controller (FC) via the "INAV Passthrough" method.
**Scope:**
- **ESP32/ESP8285**: Fully supported (Uses 8N1).
- **STM32**: **Experimental/Limited**. Standard STM32 System Bootloaders require **Even Parity (8E1)**. Standard Betaflight/INAV passthrough (`serialpassthrough`) typically forces **8N1**. Thus, STM32 flashing will likely fail unless the receiver uses a custom 8N1 bootloader.

## User Review Required
> [!IMPORTANT]  
> - **Flight Controller State**: Must be in a state accepting MSP commands (disarmed, USB connected).
> - **Exclusive Access**: Close Betaflight/INAV Configurator before using.
> - **Receiver Mode**: Receiver must be in **bootloader mode** before starting.
> - **STM32 Limitation**: STM32 System Bootloader (8E1) is likely incompatible with standard passthrough (8N1).

## Proposed Changes

### 1. Shared Infrastructure Updates

#### [MODIFY] [web/src/api/stm32UartProtocol.ts](file:///Users/jlp/Documents/mLRS-Flasher/web/src/api/stm32UartProtocol.ts)
**CRITICAL FIX: Port Ownership**
- **Problem**: Currently, `Stm32UartProtocol.connect()` unconditionally calls `port.open()`. In passthrough mode, the port is *already* open (owned by `inavPassthrough`).
- **Fix**: 
    - Check `port.readable` (or `isOpen` equivalent) before opening.
    - If open, assume configuration is correct (or attempt `port.reconfigure` if supported/needed).
    - Add a `forceParity` option to `connect()`? No, passthrough restricts us to the FC's config. We must accept the port as-is.

#### [MODIFY] [web/src/api/flasher.ts](file:///Users/jlp/Documents/mLRS-Flasher/web/src/api/flasher.ts)
- **Problem**: `initApPassthrough` (and the new `inavPassthrough`) returns an *open* port. `flashESP` and `flashSTM32UART` logic needs to handle this consistently.
- **Fix**: Ensure `flashSTM32UART` passes the open port to `Stm32UartProtocol` without closing it (unless switching baud rate requires it, but passthrough usually locks baud).

### 2. Hardware API Layer

#### [NEW] [web/src/api/inavPassthrough.ts](file:///Users/jlp/Documents/mLRS-Flasher/web/src/api/inavPassthrough.ts)
- **Class `InavPassthroughService`**:
    - **`sendMspV2Command(cmd, payload)`**: Implement MSP V2 framing (header `$X`, CRC8).
    - **`getMspPorts()`**:
        - Send `MSP_CF_SERIAL_CONFIG` (ID 54).
        - Parse response to find UARTs with functionality `MSP` enabled.
        - Return list: `{ index: number, name: string }`.
    - **`enterPassthrough(uartIndex, baud)`**:
        - Send `MSP_SET_PASSTHROUGH` (ID 245).
        - Payload: `[uartIndex, baud (4 bytes?)]`? *Need to verify payload format via trial/error or assuming standard ID/Baud mapping.*
        - **Note**: If `MSP_SET_PASSTHROUGH` doesn't take args, we might need to use CLI command `serialpassthrough` via `MSP_CLI` (ID 244) as a fallback?
            - *Decision*: Try `serialpassthrough` via CLI command (MSP ID 244) first? It's more robust documented.
            - **Revised Strategy**: Use **MSP_SET_PASSTHROUGH (245)** if arguments are known, otherwise wrap the **CLI command** `serialpassthrough <id> <baud>` inside `MSP_CLI` (ID 244).
            - *Refined*: `MSP_SET_PASSTHROUGH` is simpler if it works. Let's assume we use the CLI approach via MSP if 245 fails or is undocumented.
            - *Actually*, `serialpassthrough` via CLI (MSP 244) is the standard "Configurator" way.
            - **Plan**: Implement `sendMspCliCommand("serialpassthrough " + id + " 115200")`.

### 3. Flasher Logic Integration

#### [MODIFY] [web/src/api/flasher.ts](file:///Users/jlp/Documents/mLRS-Flasher/web/src/api/flasher.ts)
- Add `flashMethod === 'inav_passthrough'`.
- **Workflow**:
    1. `InavPassthrough.connect(port)`.
    2. `InavPassthrough.enterPassthrough(uartIndex, 115200)`.
    3. **Handover**: Call `flashESP` or `flashSTM32UART`.
    4. **Cleanup**: On completion/error, ensure port is closed.

### 4. UI/UX

#### [MODIFY] [web/src/components/FirmwareFlasherPanel.tsx](file:///Users/jlp/Documents/mLRS-Flasher/web/src/components/FirmwareFlasherPanel.tsx)
- **Dropdown**: Add "INAV Passthrough".
- **Dynamic Inputs**:
    - If `inav_passthrough` selected:
        - Show "Flight Controller Port" (main Serial selection).
        - Show "Target UART Index" (Numeric Input or Fetch button).
        - **"Scan UARTs" Button**: Connects, runs `getMspPorts`, populates a dropdown, disconnects.
- **Warnings**:
    - If Chipset == STM32, show warning: "STM32 System Bootloader (8E1) may not work with standard passthrough (8N1). Use only if Receiver has custom bootloader."

## Verification Plan

### Step 1: Unit/Logic Test
- Verify `Stm32UartProtocol` can handle an already-open port (mocked).
- Verify MSP V2 framing generation.

### Step 2: Live ESP32 Test
- Connect ESP32 receiver to FC UART 1.
- Flash FC with Betaflight/INAV.
- Use Flasher -> Select "INAV Passthrough" -> Scan -> Select UART 1.
- Flash ESP32 firmware.
- **Success**: Flashing completes.

### Step 3: Live STM32 Test (Expect Failure/Caveat)
- Connect STM32 receiver (System Bootloader).
- Attempt flash.
- **Expectation**: `Stm32UartProtocol` Sync fails (Timeout/NACK) due to parity mismatch.
- **Mitigation**: Log clear error "Possible parity mismatch (8E1 vs 8N1)".

## Technical Details: MSP V2 Frame
- Header: `$X`
- Flag: `u8` (0 = request, 1 = error, 2 = success)
- Function: `u16` (Little Endian)
- Size: `u16` (Little Endian)
- Payload: `u8[]`
- CRC: `u8` (CRC8_DVB_S2 of Flag + Func + Size + Payload)