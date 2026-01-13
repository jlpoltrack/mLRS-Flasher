// stm32 chip constants
// page sizes for various stm32 chip families

/**
 * page sizes in bytes indexed by chip ID
 * used for calculating which flash pages to erase
 */
export const CHIP_PAGE_SIZES: Record<number, number> = {
    0x410: 1024,  // STM32F1 Medium Density
    0x414: 2048,  // STM32F1 High Density
    0x415: 2048,  // STM32L433/L443
    0x435: 2048,  // STM32G431/G441 (Category 2)
    0x462: 2048,  // STM32L45x/46x
    0x413: 2048,  // STM32F4
    0x419: 2048,  // STM32F4
    0x497: 2048,  // STM32WLE5 (LoRa SOC)
};

/** default page size if chip ID is unknown */
export const DEFAULT_PAGE_SIZE = 2048;

/** standard STM32 flash base address */
export const FLASH_BASE = 0x08000000;

/** maximum flash size to check (2MB) */
export const MAX_FLASH_SIZE = 0x200000;

/**
 * get page size for a given chip ID
 */
export function getPageSize(chipId: number): number {
    return CHIP_PAGE_SIZES[chipId] ?? DEFAULT_PAGE_SIZE;
}

/**
 * check if chip ID is known
 */
export function isKnownChip(chipId: number): boolean {
    return chipId in CHIP_PAGE_SIZES;
}
