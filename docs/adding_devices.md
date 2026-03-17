# Adding New Devices to mLRS Flasher

This guide explains how to add support for new hardware (Transmitters or Receivers) to the mLRS Flasher desktop application.

Device definitions are located in: `web/src/api/metadata.ts`.

## Overview

Adding a device requires two steps:
1.  **Register the Device**: Add it to one of the "Device Type Dictionaries" so it appears in the UI dropdowns.
2.  **Define Device Properties**: Add it to the `g_targetDict` to define its flashing methods, description, and any specific sub-models.

---

## Step 1: Register the Device

Locate the appropriate dictionary at the top of `web/src/api/metadata.ts` and add a new entry.

### For External Tx Modules
Add to `g_txModuleExternalDeviceTypeDict`:
```typescript
'My New Brand': { 
    'fname': 'tx-mybrand',   // Unique string found in the firmware filename
    'chipset': 'stm32'       // 'stm32', 'esp32', 'esp8285', etc.
},
```

### For Receivers
Add to `g_receiverDeviceTypeDict`:
```typescript
'My New Brand': { 
    'fname': 'rx-mybrand',
    'chipset': 'esp8285' 
},
```

### For Internal Radios
Add to `g_txModuleInternalDeviceTypeDict` (less common).

---

## Step 2: Define Device Properties

Locate `g_targetDict` and add a new entry using the `fname` you defined in Step 1.

### Basic Example
```typescript
'tx-mybrand': {
    'flashmethod': 'stlink', // Comma separated: 'stlink', 'dfu', 'uart', 'esptool', 'ardupilot_passthrough'
    'description': "Flash method: STLink\n  - connect SWD pads...\n",
},
```

### With Wireless Bridge Support
If the device has a wireless bridge (backpack) that needs flashing:

```typescript
'tx-mybrand-pro': {
    'description': "...\n",
    'wireless': {
        'chipset': 'esp8285', // Chipset of the backpack
        'reset': 'dtr',       // Reset method: 'dtr', 'no dtr'
        'baud': 460800,       // Baudrate for flashing
        'erase': 'full_erase' // Optional: Force full erase
    }
},
```

### Handling Sub-Models
If a single brand has multiple specific devices with different settings (e.g., `tx-radiomaster`), you can nest them. The key must match a substring in the specific firmware file.

```typescript
'tx-mybrand': {
    'description': "Generic description...",
    // Specific model overrides
    'tx-mybrand-mini': {
         'description': "Specific instructions for Mini...",
         'wireless': { ... }
    },
    'tx-mybrand-pro': {
         'description': "Specific instructions for Pro...",
         'wireless': { ... }
    }
}
```

## Common Flash Methods
- `stlink`: STM32 ST-Link
- `dfu`: STM32 DFU Mode
- `uart`: STM32 serial bootloader
- `esptool`: ESP32/ESP8266 serial bootloader
- `ardupilot_passthrough`: ArduPilot Passthrough (usually added as a secondary option)
- `inav_passthrough`: INAV Passthrough (usually added as a secondary option)
