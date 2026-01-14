// stlink command protocol constants
// ported from stlink-org/stlink inc/stlink_cmd.h
// date: 2026-01-14

// main commands
export const STLINK_GET_VERSION = 0xf1;
export const STLINK_DEBUG_COMMAND = 0xf2;
export const STLINK_DFU_COMMAND = 0xf3;
export const STLINK_GET_CURRENT_MODE = 0xf5;
export const STLINK_GET_TARGET_VOLTAGE = 0xf7;
export const STLINK_GET_VERSION_APIV3 = 0xfb;

// debug subcommands
export const STLINK_DEBUG_ENTER_JTAG_RESET = 0x00;
export const STLINK_DEBUG_GETSTATUS = 0x01;
export const STLINK_DEBUG_FORCEDEBUG = 0x02;
export const STLINK_DEBUG_APIV1_RESETSYS = 0x03;
export const STLINK_DEBUG_APIV1_READALLREGS = 0x04;
export const STLINK_DEBUG_APIV1_READREG = 0x05;
export const STLINK_DEBUG_APIV1_WRITEREG = 0x06;
export const STLINK_DEBUG_READMEM_32BIT = 0x07;
export const STLINK_DEBUG_WRITEMEM_32BIT = 0x08;
export const STLINK_DEBUG_RUNCORE = 0x09;
export const STLINK_DEBUG_STEPCORE = 0x0a;
export const STLINK_DEBUG_APIV1_SETFP = 0x0b;
export const STLINK_DEBUG_READMEM_8BIT = 0x0c;
export const STLINK_DEBUG_WRITEMEM_8BIT = 0x0d;
export const STLINK_DEBUG_APIV1_CLEARFP = 0x0e;
export const STLINK_DEBUG_APIV1_WRITEDEBUGREG = 0x0f;
export const STLINK_DEBUG_APIV1_ENTER = 0x20;
export const STLINK_DEBUG_EXIT = 0x21;
export const STLINK_DEBUG_READCOREID = 0x22;
export const STLINK_DEBUG_APIV2_ENTER = 0x30;
export const STLINK_DEBUG_APIV2_READ_IDCODES = 0x31;
export const STLINK_DEBUG_APIV2_RESETSYS = 0x32;
export const STLINK_DEBUG_APIV2_READREG = 0x33;
export const STLINK_DEBUG_APIV2_WRITEREG = 0x34;
export const STLINK_DEBUG_APIV2_WRITEDEBUGREG = 0x35;
export const STLINK_DEBUG_APIV2_READDEBUGREG = 0x36;
export const STLINK_DEBUG_APIV2_READALLREGS = 0x3a;
export const STLINK_DEBUG_APIV2_GETLASTRWSTATUS = 0x3b;
export const STLINK_DEBUG_APIV2_DRIVE_NRST = 0x3c;
export const STLINK_DEBUG_APIV2_GETLASTRWSTATUS2 = 0x3e;
export const STLINK_DEBUG_APIV2_START_TRACE_RX = 0x40;
export const STLINK_DEBUG_APIV2_STOP_TRACE_RX = 0x41;
export const STLINK_DEBUG_APIV2_GET_TRACE_NB = 0x42;
export const STLINK_DEBUG_APIV2_SWD_SET_FREQ = 0x43;
export const STLINK_DEBUG_READMEM_16BIT = 0x47;
export const STLINK_DEBUG_WRITEMEM_16BIT = 0x48;
export const STLINK_DEBUG_APIV3_SET_COM_FREQ = 0x61;
export const STLINK_DEBUG_APIV3_GET_COM_FREQ = 0x62;
export const STLINK_DEBUG_ENTER_SWD = 0xa3;
export const STLINK_DEBUG_ENTER_JTAG_NO_RESET = 0xa4;

// dfu subcommands
export const STLINK_DFU_EXIT = 0x07;

// nrst drive states
export const STLINK_DEBUG_APIV2_DRIVE_NRST_LOW = 0x00;
export const STLINK_DEBUG_APIV2_DRIVE_NRST_HIGH = 0x01;
export const STLINK_DEBUG_APIV2_DRIVE_NRST_PULSE = 0x02;

// device modes returned by STLINK_GET_CURRENT_MODE
export const STLINK_DEV_DFU_MODE = 0x00;
export const STLINK_DEV_MASS_MODE = 0x01;
export const STLINK_DEV_DEBUG_MODE = 0x02;
export const STLINK_DEV_SWIM_MODE = 0x03;
export const STLINK_DEV_BOOTLOADER_MODE = 0x04;

// core status
export const STLINK_CORE_RUNNING = 0x80;
export const STLINK_CORE_HALTED = 0x81;

// command/buffer sizes
export const STLINK_CMD_SIZE = 16;
export const STLINK_DATA_SIZE = 4096;

// swd frequency options for apiv2 (khz)
export const STLINK_SWD_FREQ_MAP: Record<number, number> = {
  4000: 0,
  1800: 1,
  1200: 2,
  950: 3,
  480: 7,
  240: 15,
  125: 31,
  100: 40,
  50: 79,
  25: 158,
  15: 265,
  5: 798,
};
