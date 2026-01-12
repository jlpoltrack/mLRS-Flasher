# ArduPilot Passthrough Flashing

The **AP Passthru** (ArduPilot Passthrough) feature allows you to flash an mLRS receiver connected to an ArduPilot Flight Controller (FC) without disconnecting it from the drone. This is done by establishing a serial passthrough from the FC's USB port to the serial port where the receiver is connected.

## Prerequisites

*   **Flight Controller**: Running ArduPilot firmware.
*   **Connection**: FC connected to the computer via USB.
*   **Receiver**: mLRS receiver connected to a hardware serial port (UART) on the FC.
*   **Protocol**: The serial port on the FC *should* ideally be configured for MAVLink (Protocol 2), but the tool negotiates this.

## How it Works

The mLRS Flasher tool automates the following steps using the `scripts/apInitPassthru.py` script:

1.  **Connects to FC**: Establishes a MAVLink connection to the Flight Controller over USB.
2.  **Configures Passthrough**:
    *   Temporarily sets the receiver's serial port protocol to **MAVLink2** (`SERIALx_PROTOCOL = 2`).
    *   Sets `SERIAL_PASSTIMO` to `0` (no timeout).
    *   Sets `SERIAL_PASS2` to the receiver's serial port number (e.g., `SERIAL2`).
3.  **Bootloader Mode**: Sends a command to the receiver to reboot into **System Bootloader** mode.
4.  **Flashing**: Once the passthrough is active, the tool runs the standard STM32 or ESP flasher (STM32CubeProgrammer or esptool) through the FC's USB port, targeting the receiver.

## Using AP Passthru in mLRS Flasher

1.  Open the **mLRS Flasher**.
2.  Select your **Device** (Receiver) and desired **Firmware Version**.
3.  Set **Flash Method** to `AP Passthru`.
    *   *Note: This option is available when the firmware metadata supports it.*
4.  **Passthrough Serial**: Select the serial port number on the FC where the receiver is connected (e.g., `SERIAL1`, `SERIAL2`).
    *   Check your flight controller's wiring or parameters (`SERIALx_PROTOCOL`) if unsure.
5.  **COM Port**: Select the USB COM port of the Flight Controller.
6.  Click **Flash Receiver**.

## Technical Details

### Scripting Mode
Some setups might require the "Scripting" protocol (`28`) instead of MAVLink. The tool handles this by setting `SERIALx_PROTOCOL = 28` and requesting a power cycle if needed.

### Restoration
After flashing, you may need to power cycle the flight controller to exit passthrough mode completely and restore normal operation. The parameters changed (`SERIAL_PASSTIMO`, `SERIAL_PASS2`) are typically not saved to permanent storage during this temporary process, but `SERIALx_PROTOCOL` might need verification if the process is interrupted.

## Troubleshooting

*   **Connection Failed**: Ensure the FC is not armed and allows MAVLink connections on USB.
*   **Wrong Serial Port**: Verify which UART the receiver is wired to.
*   **Baud Rate**: The tool attempts to detect baud rate, but 115200 or 57600 are common defaults.
