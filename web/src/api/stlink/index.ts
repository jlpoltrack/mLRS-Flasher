// stlink module public exports
// date: 2026-01-14

// types and interfaces
export * from './types';

// command constants
export * from './stlinkCommands';

// usb layer
export {
  StlinkUsb,
  STLINK_VID,
  STLINK_USB_PIDS,
  STLINK_SUPPORTED_PIDS,
  getStlinkFilters,
  isStlinkDevice,
  getStlinkVersionFromPid,
  requestStlinkDevice,
  getPairedStlinkDevices,
} from './stlinkUsb';

// chip database
export {
  CHIP_DATABASE,
  FLASH_BASE,
  SRAM_BASE,
  getChipInfo,
  getFlashPageSize,
  isKnownChip,
  getSupportedChipIds,
  formatChipId,
} from './chipDatabase';

// device interface
export { StlinkDevice } from './stlinkDevice';

// flash operations
export { FlashOperations } from './flashOperations';
