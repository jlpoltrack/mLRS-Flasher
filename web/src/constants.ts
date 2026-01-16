// constants.ts - centralized constants for the mLRS Flasher
// last updated: 2026-01-13

/**
 * device target types for firmware flashing
 */
export const TargetType = {
  Receiver: 'rx',
  TxExternal: 'tx',
  TxInternal: 'txint',
} as const;

export type TargetType = typeof TargetType[keyof typeof TargetType];

/**
 * backend target names expected by the python script
 */
export const BackendTarget = {
  Receiver: 'receiver',
  TxModule: 'tx_module',
  WirelessBridge: 'wireless_bridge',
} as const;

export type BackendTarget = typeof BackendTarget[keyof typeof BackendTarget];

export const DEFAULT_FLASH_METHOD = 'default';

/**
 * available flash methods for programming devices
 */
export const FlashMethod = {
  UART: 'uart',
  DFU: 'dfu',
  ESPTool: 'esptool',
  STLink: 'stlink',
  APPassthru: 'appassthru',
  InavPassthrough: 'inav_passthrough',
  ELRSBL: 'elrsbl',
} as const;

export type FlashMethod = typeof FlashMethod[keyof typeof FlashMethod];

/**
 * log message types for console output
 */
export const LogType = {
  Info: 'info',
  Error: 'error',
  Warning: 'warning',
  Progress: 'progress',
  Success: 'success',
} as const;

export type LogType = typeof LogType[keyof typeof LogType];

/**
 * display titles for each target type
 */
export const TARGET_TITLES: Record<TargetType, string> = {
  [TargetType.Receiver]: 'Receiver',
  [TargetType.TxExternal]: 'Tx Module (External)',
  [TargetType.TxInternal]: 'Tx Module (Internal)',
};

/**
 * configuration for each device view
 */
export interface DeviceViewConfig {
  title: string;
  targetType: TargetType;
  showSerialX: boolean;
  allowWirelessBridge: boolean;
}

export const DEVICE_CONFIGS: Record<TargetType, DeviceViewConfig> = {
  [TargetType.Receiver]: {
    title: 'Receiver',
    targetType: TargetType.Receiver,
    showSerialX: true,
    allowWirelessBridge: false,
  },
  [TargetType.TxExternal]: {
    title: 'Tx Module (External)',
    targetType: TargetType.TxExternal,
    showSerialX: false,
    allowWirelessBridge: true,
  },
  [TargetType.TxInternal]: {
    title: 'Tx Module (Internal)',
    targetType: TargetType.TxInternal,
    showSerialX: false,
    allowWirelessBridge: true,
  },
};

/**
 * serial port filter presets for common devices
 */
export const SERIAL_FILTERS = [
  { usbVendorId: 0x0483, usbProductId: 0x5740 }, // EdgeTX/OpenTX
  { usbVendorId: 0x0483, usbProductId: 0x374E }, // ST-Link
  { usbVendorId: 0x1209 },                       // ArduPilot
  { usbVendorId: 0x10C4 },                       // CP210x (Silicon Labs)
  { usbVendorId: 0x0403 },                       // FTDI
  { usbVendorId: 0x1A86 },                       // CH340 (WCH)
] as const;

/**
 * usb device filter presets
 */
export const USB_FILTERS = [
  { vendorId: 0x0483 }, // STM32 Vendor ID
] as const;
