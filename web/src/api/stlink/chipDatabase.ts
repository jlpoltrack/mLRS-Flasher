// chip database for target stm32 families
// date: 2026-01-14

import type { ChipInfo } from './types';
import { ChipFlags, FlashType } from './types';

// flash base address (common for most stm32)
export const FLASH_BASE = 0x08000000;

// sram base address (common for most stm32)
export const SRAM_BASE = 0x20000000;

// cortex-m debug registers
export const CORTEXM_DBGMCU_IDCODE_F1 = 0xe0042000; // f1, f3
export const CORTEXM_DBGMCU_IDCODE = 0xe0044000; // most others

// chip database for target mcus
export const CHIP_DATABASE: ChipInfo[] = [
  // stm32f1xx medium density (f103c8, f103cb, etc.)
  {
    devType: 'STM32F1xx_MD',
    chipId: 0x410,
    flashType: FlashType.F0_F1_F3,
    flashSizeReg: 0x1ffff7e0,
    flashPageSize: 0x400, // 1kb
    sramSize: 0x5000, // 20kb
    bootromBase: 0x1ffff000,
    bootromSize: 0x800,
    optionBase: 0x1ffff800,
    optionSize: 0x10,
    flags: ChipFlags.SWO,
    flashConfig: {
      type: 'F1',
      registerBase: 0x40022000,
      crOffset: 0x10,
      srOffset: 0x0c,
      programWidth: 16,
      eraseMethod: 'AR',
    },
  },

  // stm32f1xx high density (f103rc, f103re, etc.)
  {
    devType: 'STM32F1xx_HD',
    chipId: 0x414,
    flashType: FlashType.F0_F1_F3,
    flashSizeReg: 0x1ffff7e0,
    flashPageSize: 0x800, // 2kb
    sramSize: 0x10000, // 64kb
    bootromBase: 0x1ffff000,
    bootromSize: 0x800,
    optionBase: 0x1ffff800,
    optionSize: 0x10,
    flags: ChipFlags.SWO,
    flashConfig: {
      type: 'F1',
      registerBase: 0x40022000,
      crOffset: 0x10,
      srOffset: 0x0c,
      programWidth: 16,
      eraseMethod: 'AR',
    },
  },

  // stm32f1xx low density (f103x4, f103x6)
  {
    devType: 'STM32F1xx_LD',
    chipId: 0x412,
    flashType: FlashType.F0_F1_F3,
    flashSizeReg: 0x1ffff7e0,
    flashPageSize: 0x400, // 1kb
    sramSize: 0x2800, // 10kb
    bootromBase: 0x1ffff000,
    bootromSize: 0x800,
    optionBase: 0x1ffff800,
    optionSize: 0x10,
    flags: ChipFlags.SWO,
    flashConfig: {
      type: 'F1',
      registerBase: 0x40022000,
      crOffset: 0x10,
      srOffset: 0x0c,
      programWidth: 16,
      eraseMethod: 'AR',
    },
  },

  // stm32f3xx (f302xb/c, f303xb/c, f358)
  {
    devType: 'STM32F302_F303_358',
    chipId: 0x422,
    flashType: FlashType.F0_F1_F3,
    flashSizeReg: 0x1ffff7cc,
    flashPageSize: 0x800, // 2kb
    sramSize: 0xa000, // 40kb
    bootromBase: 0x1ffff000,
    bootromSize: 0x800,
    optionBase: 0x1ffff800,
    optionSize: 0x10,
    flags: ChipFlags.SWO,
    flashConfig: {
      type: 'F3',
      registerBase: 0x40022000,
      crOffset: 0x10,
      srOffset: 0x0c,
      programWidth: 32,
      eraseMethod: 'AR',
    },
  },

  // stm32f3xx (f301x6/8, f302x6/8, f318)
  {
    devType: 'STM32F301_F302_F318',
    chipId: 0x439,
    flashType: FlashType.F0_F1_F3,
    flashSizeReg: 0x1ffff7cc,
    flashPageSize: 0x800, // 2kb
    sramSize: 0x4000, // 16kb
    bootromBase: 0x1ffff000,
    bootromSize: 0x800,
    optionBase: 0x1ffff800,
    optionSize: 0x10,
    flags: ChipFlags.SWO,
    flashConfig: {
      type: 'F3',
      registerBase: 0x40022000,
      crOffset: 0x10,
      srOffset: 0x0c,
      programWidth: 32,
      eraseMethod: 'AR',
    },
  },

  // stm32f3xx hd (f302xd/e, f303xd/e, f398)
  {
    devType: 'STM32F302_F303_F398_HD',
    chipId: 0x446,
    flashType: FlashType.F0_F1_F3,
    flashSizeReg: 0x1ffff7cc,
    flashPageSize: 0x800, // 2kb
    sramSize: 0x10000, // 64kb
    bootromBase: 0x1ffff000,
    bootromSize: 0x2000,
    optionBase: 0x1ffff800,
    optionSize: 0x10,
    flags: ChipFlags.SWO,
    flashConfig: {
      type: 'F3',
      registerBase: 0x40022000,
      crOffset: 0x10,
      srOffset: 0x0c,
      programWidth: 32,
      eraseMethod: 'AR',
    },
  },

  // stm32g4xx cat3 (g47x, g48x)
  {
    devType: 'STM32G47x_G48x',
    chipId: 0x469,
    flashType: FlashType.G4,
    flashSizeReg: 0x1fff75e0,
    flashPageSize: 0x800, // 2kb
    sramSize: 0x20000, // 128kb
    bootromBase: 0x1fff0000,
    bootromSize: 0x7000,
    optionBase: 0x1ffff800,
    optionSize: 0x04,
    flags: ChipFlags.SWO | ChipFlags.DualBank,
    flashConfig: {
      type: 'G4/L4/WL',
      registerBase: 0x40022000,
      crOffset: 0x14,
      srOffset: 0x10,
      programWidth: 64,
      eraseMethod: 'CR_PNB',
      pnbShift: 3,
    },
  },

  // stm32g4xx cat2 (g43x, g44x)
  {
    devType: 'STM32G43x_G44x',
    chipId: 0x468,
    flashType: FlashType.G4,
    flashSizeReg: 0x1fff75e0,
    flashPageSize: 0x800, // 2kb
    sramSize: 0x8000, // 32kb
    bootromBase: 0x1fff0000,
    bootromSize: 0x7000,
    optionBase: 0x1ffff800,
    optionSize: 0x04,
    flags: ChipFlags.SWO,
    flashConfig: {
      type: 'G4/L4/WL',
      registerBase: 0x40022000,
      crOffset: 0x14,
      srOffset: 0x10,
      programWidth: 64,
      eraseMethod: 'CR_PNB',
      pnbShift: 3,
    },
  },

  // stm32g4xx cat4 (g49x, g4ax)
  {
    devType: 'STM32G49x_G4Ax',
    chipId: 0x479,
    flashType: FlashType.G4,
    flashSizeReg: 0x1fff75e0,
    flashPageSize: 0x800, // 2kb
    sramSize: 0x18000, // 96kb
    bootromBase: 0x1fff0000,
    bootromSize: 0x7000,
    optionBase: 0x1ffff800,
    optionSize: 0x04,
    flags: ChipFlags.SWO,
    flashConfig: {
      type: 'G4/L4/WL',
      registerBase: 0x40022000,
      crOffset: 0x14,
      srOffset: 0x10,
      programWidth: 64,
      eraseMethod: 'CR_PNB',
      pnbShift: 3,
    },
  },

  // stm32l4xx (l47x, l48x)
  {
    devType: 'STM32L47x_L48x',
    chipId: 0x415,
    flashType: FlashType.L4,
    flashSizeReg: 0x1fff75e0,
    flashPageSize: 0x800, // 2kb
    sramSize: 0x18000, // 96kb
    bootromBase: 0x1fff0000,
    bootromSize: 0x7000,
    optionBase: 0x1fff7800,
    optionSize: 0x04,
    flags: ChipFlags.SWO,
    flashConfig: {
      type: 'G4/L4/WL',
      registerBase: 0x40022000,
      crOffset: 0x14,
      srOffset: 0x10,
      programWidth: 64,
      eraseMethod: 'CR_PNB',
      pnbShift: 3,
    },
  },

  // stm32l4xx (l41x, l42x)
  {
    devType: 'STM32L41x_L42x',
    chipId: 0x464,
    flashType: FlashType.L4,
    flashSizeReg: 0x1fff75e0,
    flashPageSize: 0x800, // 2kb
    sramSize: 0xa000, // 40kb
    bootromBase: 0x1fff0000,
    bootromSize: 0x7000,
    optionBase: 0x1fff7800,
    optionSize: 0x04,
    flags: ChipFlags.SWO,
    flashConfig: {
      type: 'G4/L4/WL',
      registerBase: 0x40022000,
      crOffset: 0x14,
      srOffset: 0x10,
      programWidth: 64,
      eraseMethod: 'CR_PNB',
      pnbShift: 3,
    },
  },

  // stm32l4xx (l43x, l44x)
  {
    devType: 'STM32L43x_L44x',
    chipId: 0x435,
    flashType: FlashType.L4,
    flashSizeReg: 0x1fff75e0,
    flashPageSize: 0x800, // 2kb
    sramSize: 0x10000, // 64kb
    bootromBase: 0x1fff0000,
    bootromSize: 0x7000,
    optionBase: 0x1fff7800,
    optionSize: 0x04,
    flags: ChipFlags.SWO,
    flashConfig: {
      type: 'G4/L4/WL',
      registerBase: 0x40022000,
      crOffset: 0x14,
      srOffset: 0x10,
      programWidth: 64,
      eraseMethod: 'CR_PNB',
      pnbShift: 3,
    },
  },

  // stm32l4xx (l45x, l46x)
  {
    devType: 'STM32L45x_L46x',
    chipId: 0x462,
    flashType: FlashType.L4,
    flashSizeReg: 0x1fff75e0,
    flashPageSize: 0x800, // 2kb
    sramSize: 0x20000, // 128kb
    bootromBase: 0x1fff0000,
    bootromSize: 0x7000,
    optionBase: 0x1fff7800,
    optionSize: 0x04,
    flags: ChipFlags.SWO,
    flashConfig: {
      type: 'G4/L4/WL',
      registerBase: 0x40022000,
      crOffset: 0x14,
      srOffset: 0x10,
      programWidth: 64,
      eraseMethod: 'CR_PNB',
      pnbShift: 3,
    },
  },

  // stm32wlex
  {
    devType: 'STM32WLEx',
    chipId: 0x497,
    flashType: FlashType.WB_WL,
    flashSizeReg: 0x1fff75e0,
    flashPageSize: 0x800, // 2kb
    sramSize: 0x10000, // 64kb
    bootromBase: 0x1fff0000,
    bootromSize: 0x7000,
    optionBase: 0x1fff7800,
    optionSize: 0x10,
    flags: ChipFlags.SWO | ChipFlags.DualBank,
    flashConfig: {
      type: 'G4/L4/WL',
      registerBase: 0x58004000,
      crOffset: 0x14,
      srOffset: 0x10,
      programWidth: 64,
      eraseMethod: 'CR_PNB',
      pnbShift: 3,
    },
  },

  // stm32wl3x (lower capacity wl)
  {
    devType: 'STM32WL3x',
    chipId: 0x494,
    flashType: FlashType.WB_WL,
    flashSizeReg: 0x1fff75e0,
    flashPageSize: 0x800, // 2kb
    sramSize: 0x8000, // 32kb
    bootromBase: 0x1fff0000,
    bootromSize: 0x7000,
    optionBase: 0x1fff7800,
    optionSize: 0x10,
    flags: ChipFlags.SWO,
    flashConfig: {
      type: 'G4/L4/WL',
      registerBase: 0x58004000,
      crOffset: 0x14,
      srOffset: 0x10,
      programWidth: 64,
      eraseMethod: 'CR_PNB',
      pnbShift: 3,
    },
  },
];

/**
 * lookup chip info by chip id
 */
export function getChipInfo(chipId: number): ChipInfo | undefined {
  // mask off revision bits - only keep device id
  const devId = chipId & 0xfff;
  return CHIP_DATABASE.find((chip) => chip.chipId === devId);
}

/**
 * get flash page size for a chip
 */
export function getFlashPageSize(chipId: number): number {
  const info = getChipInfo(chipId);
  return info?.flashPageSize ?? 0x400; // default to 1kb
}

/**
 * check if chip id is known
 */
export function isKnownChip(chipId: number): boolean {
  return getChipInfo(chipId) !== undefined;
}

/**
 * get all supported chip ids
 */
export function getSupportedChipIds(): number[] {
  return CHIP_DATABASE.map((chip) => chip.chipId);
}

/**
 * format chip id for display
 */
export function formatChipId(chipId: number): string {
  const info = getChipInfo(chipId);
  if (info) {
    return `${info.devType} (0x${chipId.toString(16).padStart(3, '0')})`;
  }
  return `Unknown (0x${chipId.toString(16).padStart(3, '0')})`;
}
