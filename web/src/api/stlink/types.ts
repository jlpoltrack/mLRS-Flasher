// stlink typescript interfaces and types
// date: 2026-01-14

// stlink hardware version info
export interface StlinkVersion {
  stlinkV: number;       // st-link hardware version (1, 2, 3)
  jtagV: number;         // jtag firmware version
  swimV: number;         // swim firmware version
  vid: number;           // usb vendor id
  pid: number;           // usb product id
  apiVersion: 1 | 2 | 3; // jtag api version
  flags: number;         // capability flags
}

// target core state
export const TargetState = {
  Unknown: 0,
  Running: 1,
  Halted: 2,
  Reset: 3,
  DebugRunning: 4,
} as const;
export type TargetState = (typeof TargetState)[keyof typeof TargetState];

// stlink device mode
export const StlinkMode = {
  Unknown: -1,
  Dfu: 0,
  Mass: 1,
  Debug: 2,
  Swim: 3,
  Bootloader: 4,
} as const;
export type StlinkMode = (typeof StlinkMode)[keyof typeof StlinkMode];

// chip capability flags
export const ChipFlags = {
  None: 0,
  SWO: 1 << 0,
  DualBank: 1 << 1,
} as const;
export type ChipFlags = (typeof ChipFlags)[keyof typeof ChipFlags];

// flash memory type determines programming algorithm
export const FlashType = {
  Unknown: 'Unknown',
  F0_F1_F3: 'F0_F1_F3',  // stm32f0, f1, f3 - simple halfword programming
  F2_F4: 'F2_F4',        // stm32f2, f4 - sector-based with parallelism
  F7: 'F7',              // stm32f7 - similar to f4
  G0: 'G0',              // stm32g0 - doubleword programming
  G4: 'G4',              // stm32g4 - 72-bit wide, dual bank
  H7: 'H7',              // stm32h7 - 256-bit programming
  L0: 'L0',              // stm32l0 - half-page programming
  L1: 'L1',              // stm32l1 - similar to l0
  L4: 'L4',              // stm32l4 - 72-bit wide, dual bank
  L5: 'L5',              // stm32l5 - similar to l4
  WB_WL: 'WB_WL',        // stm32wb, wl - similar to l4
} as const;
export type FlashType = (typeof FlashType)[keyof typeof FlashType];

// flash driver configuration
export interface FlashDriverConfig {
  type: 'F1' | 'F3' | 'G4/L4/WL';
  registerBase: number;
  crOffset: number;
  srOffset: number;
  programWidth: 16 | 32 | 64;
  eraseMethod: 'AR' | 'CR_PNB';
  pnbShift?: number; // bit shift for page number in CR (for CR_PNB method)
}

// chip information from database
export interface ChipInfo {
  devType: string;        // e.g., "STM32F1xx_MD"
  chipId: number;         // dbgmcu idcode (e.g., 0x410)
  flashType: FlashType;
  flashSizeReg: number;   // address to read flash size
  flashPageSize: number;  // bytes per page/sector
  sramSize: number;       // sram size in bytes
  bootromBase: number;    // system memory base
  bootromSize: number;    // system memory size
  optionBase: number;     // option bytes base
  optionSize: number;     // option bytes size
  flags: number;          // bitmask of ChipFlags
  flashConfig: FlashDriverConfig;
}

// stlink capability flags (from firmware version)
export const StlinkFlags = {
  None: 0,
  HasTrace: 1 << 0,
  HasGetLastRwStatus2: 1 << 1,
  HasDapReg: 1 << 2,
  HasMemWr16No512: 1 << 3,
  HasMemRd16No512: 1 << 4,
  HasApInit: 1 << 5,
  HasDpBank: 1 << 6,
  HasRw8_512Bytes: 1 << 9,
} as const;
export type StlinkFlags = (typeof StlinkFlags)[keyof typeof StlinkFlags];

// connection type for opening device
export const ConnectType = {
  HotPlug: 0,   // connect without reset
  Normal: 1,    // normal connect
  UnderReset: 2, // connect with reset held low
} as const;
export type ConnectType = (typeof ConnectType)[keyof typeof ConnectType];

// reset type
export const ResetType = {
  Auto: 0,
  Hard: 1,
  Soft: 2,
  SoftAndHalt: 3,
} as const;
export type ResetType = (typeof ResetType)[keyof typeof ResetType];

// log levels for debugging
export type LogLevel = 'debug' | 'info' | 'warn' | 'error';

// logging callback
export type LogCallback = (level: LogLevel, message: string) => void;

// progress callback for flash operations
export type ProgressCallback = (percent: number, status: string) => void;

// flash operation result
export interface FlashResult {
  success: boolean;
  bytesWritten: number;
  error?: string;
}
