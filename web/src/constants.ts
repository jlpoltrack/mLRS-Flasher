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
 * available flash methods for programming devices
 */
export const FlashMethod = {
  UART: 'uart',
  DFU: 'dfu',
  ESPTool: 'esptool',
  STLink: 'stlink',
  APPassthru: 'appassthru',
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
