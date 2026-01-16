// high-level st-link device interface
// date: 2026-01-14

import { StlinkUsb } from './stlinkUsb';
import {
  STLINK_DEBUG_COMMAND,
  STLINK_DFU_COMMAND,
  STLINK_DFU_EXIT,
  STLINK_DEBUG_EXIT,
  STLINK_DEBUG_ENTER_SWD,
  STLINK_DEBUG_APIV2_ENTER,
  STLINK_DEBUG_FORCEDEBUG,
  STLINK_DEBUG_GETSTATUS,
  STLINK_DEBUG_RUNCORE,
  STLINK_DEBUG_APIV1_RESETSYS,
  STLINK_DEBUG_APIV2_DRIVE_NRST,
  STLINK_DEBUG_APIV2_DRIVE_NRST_LOW,
  STLINK_DEBUG_APIV2_DRIVE_NRST_HIGH,
  STLINK_DEBUG_APIV2_DRIVE_NRST_PULSE,
  STLINK_DEBUG_READMEM_32BIT,
  STLINK_DEBUG_WRITEMEM_32BIT,
  STLINK_DEBUG_READMEM_16BIT,
  STLINK_DEBUG_WRITEMEM_16BIT,
  STLINK_DEBUG_WRITEMEM_8BIT,
  STLINK_DEBUG_APIV2_READDEBUGREG,
  STLINK_DEBUG_APIV2_WRITEDEBUGREG,
  STLINK_DEBUG_READCOREID,
  STLINK_DEBUG_APIV2_SWD_SET_FREQ,
  STLINK_CORE_HALTED,
  STLINK_CORE_RUNNING,
  STLINK_SWD_FREQ_MAP,
} from './stlinkCommands';
import type {
  StlinkVersion,
  ChipInfo,
  LogCallback,
} from './types';
import {
  StlinkMode,
  TargetState,
  ConnectType,
} from './types';
import {
  getChipInfo,
  formatChipId,
  CORTEXM_DBGMCU_IDCODE,
  CORTEXM_DBGMCU_IDCODE_F1,
} from './chipDatabase';

// cortex-m debug halting control and status register
const DHCSR = 0xe000edf0;
const DHCSR_DBGKEY = 0xa05f0000;
const DHCSR_C_HALT = 0x00000002;
const DHCSR_C_DEBUGEN = 0x00000001;
// const DHCSR_C_MASKINTS = 0x00000004; // reserved for flash loader
const DHCSR_S_HALT = 0x00020000;
const DHCSR_S_RESET_ST = 0x02000000;

// cortex-m reset control register
const AIRCR = 0xe000ed0c;
const AIRCR_VECTKEY = 0x05fa0000;
const AIRCR_SYSRESETREQ = 0x00000004;

/**
 * high-level interface to st-link device
 */
export class StlinkDevice {
  private usb: StlinkUsb;
  private log: LogCallback;
  private _version: StlinkVersion | null = null;
  private _chipInfo: ChipInfo | null = null;
  private _flashSize: number = 0;
  private _sramSize: number = 0;
  private _chipId: number = 0;

  constructor(device: USBDevice, log?: LogCallback) {
    this.log = log || (() => {});
    this.usb = new StlinkUsb(device, this.log);
  }

  // getters
  get version(): StlinkVersion | null {
    return this._version;
  }

  get chipInfo(): ChipInfo | null {
    return this._chipInfo;
  }

  get flashSize(): number {
    return this._flashSize;
  }

  get sramSize(): number {
    return this._sramSize;
  }

  get chipId(): number {
    return this._chipId;
  }

  /**
   * connect to the target via st-link
   */
  async connect(connectType: ConnectType = ConnectType.Normal): Promise<void> {
    this.log('info', 'Connecting to ST-Link...');

    await this.usb.open();
    this._version = await this.usb.getVersion();

    // check current mode and exit dfu if needed
    const mode = await this.usb.getCurrentMode();
    if (mode === StlinkMode.Dfu) {
      this.log('debug', 'Exiting DFU mode...');
      await this.exitDfuMode();
    }

    // enter swd mode
    await this.enterSwdMode(connectType);

    // detect the target chip
    await this.detectChip();

    this.log('info', `Connected to ${formatChipId(this._chipId)}`);
  }

  /**
   * disconnect from the target
   */
  async disconnect(): Promise<void> {
    this.log('info', 'Disconnecting from ST-Link...');
    try {
      await this.exitDebugMode();
    } catch (e) {
      this.log('warn', `Error exiting debug mode: ${e}`);
    }
    await this.usb.close();
  }

  /**
   * exit dfu mode
   */
  private async exitDfuMode(): Promise<void> {
    const cmd = new Uint8Array([STLINK_DFU_COMMAND, STLINK_DFU_EXIT]);
    await this.usb.sendCommand(cmd, 0);
    // small delay for mode switch
    await this.delay(100);
  }

  /**
   * enter swd debug mode
   */
  async enterSwdMode(
    connectType: ConnectType = ConnectType.Normal
  ): Promise<void> {
    this.log('debug', 'Entering SWD mode...');

    if (!this._version) {
      throw new Error('Version not read');
    }

    // set swd frequency for v2 (1000 khz default)
    if (this._version.apiVersion === 2) {
      await this.setSwdFrequency(1000);
    }

    // handle connect under reset
    if (connectType === ConnectType.UnderReset) {
      await this.driveNrst(false); // hold reset low
    }

    // enter swd mode command depends on api version
    let cmd: Uint8Array;
    if (this._version.apiVersion === 1) {
      // api v1: DEBUG_COMMAND + APIV1_ENTER + ENTER_SWD
      cmd = new Uint8Array([STLINK_DEBUG_COMMAND, 0x20, STLINK_DEBUG_ENTER_SWD]);
    } else {
      // api v2/v3: DEBUG_COMMAND + APIV2_ENTER + ENTER_SWD
      cmd = new Uint8Array([
        STLINK_DEBUG_COMMAND,
        STLINK_DEBUG_APIV2_ENTER,
        STLINK_DEBUG_ENTER_SWD,
      ]);
    }

    const response = await this.usb.sendCommand(cmd, 2);
    this.checkStatus(response);

    // release reset if we were holding it
    if (connectType === ConnectType.UnderReset) {
      await this.driveNrst(true); // release reset
      await this.delay(10);
    }
  }

  /**
   * exit debug mode
   */
  async exitDebugMode(): Promise<void> {
    this.log('debug', 'Exiting debug mode...');
    const cmd = new Uint8Array([STLINK_DEBUG_COMMAND, STLINK_DEBUG_EXIT]);
    await this.usb.sendCommand(cmd, 0);
  }

  /**
   * set swd clock frequency (v2 only)
   */
  private async setSwdFrequency(khz: number): Promise<void> {
    // find closest supported frequency
    const freqs = Object.keys(STLINK_SWD_FREQ_MAP)
      .map(Number)
      .sort((a, b) => b - a);
    let divisor = STLINK_SWD_FREQ_MAP[freqs[freqs.length - 1]];

    for (const freq of freqs) {
      if (khz >= freq) {
        divisor = STLINK_SWD_FREQ_MAP[freq];
        break;
      }
    }

    const cmd = new Uint8Array([
      STLINK_DEBUG_COMMAND,
      STLINK_DEBUG_APIV2_SWD_SET_FREQ,
      divisor & 0xff,
      (divisor >> 8) & 0xff,
    ]);

    const response = await this.usb.sendCommand(cmd, 2);
    this.checkStatus(response);
  }

  /**
   * drive nrst pin
   */
  async driveNrst(high: boolean): Promise<void> {
    const state = high
      ? STLINK_DEBUG_APIV2_DRIVE_NRST_HIGH
      : STLINK_DEBUG_APIV2_DRIVE_NRST_LOW;
    const cmd = new Uint8Array([
      STLINK_DEBUG_COMMAND,
      STLINK_DEBUG_APIV2_DRIVE_NRST,
      state,
    ]);
    const response = await this.usb.sendCommand(cmd, 2);
    this.checkStatus(response);
  }

  /**
   * pulse nrst to reset target
   */
  async pulseNrst(): Promise<void> {
    const cmd = new Uint8Array([
      STLINK_DEBUG_COMMAND,
      STLINK_DEBUG_APIV2_DRIVE_NRST,
      STLINK_DEBUG_APIV2_DRIVE_NRST_PULSE,
    ]);
    const response = await this.usb.sendCommand(cmd, 2);
    this.checkStatus(response);
  }

  /**
   * detect the connected chip
   */
  async detectChip(): Promise<ChipInfo | null> {
    // try reading chip id from common location first
    let chipId = await this.readChipId(CORTEXM_DBGMCU_IDCODE);

    // if that didn't work, try f1 location
    if (chipId === 0 || chipId === 0xffffffff) {
      chipId = await this.readChipId(CORTEXM_DBGMCU_IDCODE_F1);
    }

    if (chipId === 0 || chipId === 0xffffffff) {
      this.log('warn', 'Could not read chip ID');
      return null;
    }

    this._chipId = chipId & 0xfff; // mask off revision
    this._chipInfo = getChipInfo(this._chipId) ?? null;

    if (this._chipInfo) {
      // read actual flash size from device
      const flashSizeKb = await this.readFlashSize(
        this._chipInfo.flashSizeReg
      );
      this._flashSize = flashSizeKb * 1024;
      this._sramSize = this._chipInfo.sramSize;

      this.log(
        'info',
        `Chip: ${this._chipInfo.devType}, Flash: ${flashSizeKb}KB, SRAM: ${this._sramSize / 1024}KB`
      );
    } else {
      this.log('warn', `Unknown chip ID: 0x${this._chipId.toString(16)}`);
    }

    return this._chipInfo;
  }

  /**
   * read chip id from dbgmcu register
   */
  private async readChipId(addr: number): Promise<number> {
    try {
      const data = await this.readMem32(addr, 4);
      return (
        data[0] | (data[1] << 8) | (data[2] << 16) | (data[3] << 24)
      );
    } catch {
      return 0;
    }
  }

  /**
   * read flash size from device
   */
  private async readFlashSize(addr: number): Promise<number> {
    try {
      const data = await this.readMem32(addr, 2);
      return data[0] | (data[1] << 8);
    } catch {
      return 0;
    }
  }

  /**
   * halt the cpu
   */
  async halt(): Promise<void> {
    this.log('debug', 'Halting CPU...');

    // write to dhcsr to halt
    await this.writeDebugReg(
      DHCSR,
      DHCSR_DBGKEY | DHCSR_C_HALT | DHCSR_C_DEBUGEN
    );

    // wait for halt
    for (let i = 0; i < 100; i++) {
      const status = await this.getStatus();
      if (status === TargetState.Halted) {
        return;
      }
      await this.delay(10);
    }

    throw new Error('Failed to halt CPU');
  }

  /**
   * run the cpu
   */
  async run(): Promise<void> {
    this.log('debug', 'Running CPU...');

    if (!this._version) {
      throw new Error('Version not read');
    }

    // for api v2/v3, use dhcsr register write (clears halt bit)
    if (this._version.apiVersion >= 2) {
      await this.writeDebugReg(DHCSR, DHCSR_DBGKEY | DHCSR_C_DEBUGEN);
      return;
    }

    // api v1 uses legacy command
    const cmd = new Uint8Array([STLINK_DEBUG_COMMAND, STLINK_DEBUG_RUNCORE]);
    const response = await this.usb.sendCommand(cmd, 2);
    this.checkStatus(response);
  }

  /**
   * reset the target
   */
  async reset(): Promise<void> {
    this.log('debug', 'Resetting target...');

    if (!this._version) {
      throw new Error('Version not read');
    }

    // for api v2/v3, use aircr register to trigger system reset
    if (this._version.apiVersion >= 2) {
      // halt first to ensure we can regain control after reset
      try {
        await this.halt();
      } catch (e) {
        this.log('warn', `Could not halt before reset: ${e}`);
      }

      // try aircr software reset first
      this.log('debug', 'Resetting via AIRCR...');
      await this.writeDebugReg(AIRCR, AIRCR_VECTKEY | AIRCR_SYSRESETREQ);
      
      // wait a bit and check if reset happened
      await this.delay(50);
      
      try {
        const dhcsr = await this.readDebugReg(DHCSR);
        if (dhcsr & DHCSR_S_RESET_ST) {
           this.log('debug', 'System reset detected via DHCSR');
           return;
        }
      } catch {
         // ignore read error during reset
      }

      // if aircr didn't work (or we couldn't verify), try pulse nrst
      this.log('debug', 'Pulsing NRST...');
      try {
        await this.pulseNrst();
      } catch {
        this.log('warn', 'NRST pulse failed (feature might not be supported)');
      }
      
      await this.delay(100);
      return;
    }

    // api v1 uses legacy command
    const cmd = new Uint8Array([
      STLINK_DEBUG_COMMAND,
      STLINK_DEBUG_APIV1_RESETSYS,
    ]);
    const response = await this.usb.sendCommand(cmd, 2);
    this.checkStatus(response);

    await this.delay(50);
  }

  /**
   * get current target status
   */
  async getStatus(): Promise<TargetState> {
    if (!this._version) {
      throw new Error('Version not read');
    }

    // for api v2/v3, read dhcsr register directly
    if (this._version.apiVersion >= 2) {
      const dhcsr = await this.readDebugReg(DHCSR);
      this.log('debug', `DHCSR: 0x${dhcsr.toString(16)}`);

      if (dhcsr & DHCSR_S_HALT) {
        return TargetState.Halted;
      } else if (dhcsr & DHCSR_S_RESET_ST) {
        return TargetState.Unknown; // reset state
      }
      return TargetState.Running;
    }

    // api v1 uses legacy command
    const cmd = new Uint8Array([STLINK_DEBUG_COMMAND, STLINK_DEBUG_GETSTATUS]);
    const response = await this.usb.sendCommand(cmd, 2);

    const status = response[0];
    if (status === STLINK_CORE_HALTED) {
      return TargetState.Halted;
    } else if (status === STLINK_CORE_RUNNING) {
      return TargetState.Running;
    }
    return TargetState.Unknown;
  }

  /**
   * force debug mode
   */
  async forceDebug(): Promise<void> {
    const cmd = new Uint8Array([
      STLINK_DEBUG_COMMAND,
      STLINK_DEBUG_FORCEDEBUG,
    ]);
    const response = await this.usb.sendCommand(cmd, 2);
    this.checkStatus(response);
  }

  /**
   * read 32-bit aligned memory
   */
  async readMem32(addr: number, len: number): Promise<Uint8Array> {
    // must be 4-byte aligned
    if (addr & 3) {
      throw new Error('Address must be 4-byte aligned');
    }
    if (len & 3) {
      len = (len + 3) & ~3; // round up
    }

    const cmd = new Uint8Array(16);
    cmd[0] = STLINK_DEBUG_COMMAND;
    cmd[1] = STLINK_DEBUG_READMEM_32BIT;
    cmd[2] = addr & 0xff;
    cmd[3] = (addr >> 8) & 0xff;
    cmd[4] = (addr >> 16) & 0xff;
    cmd[5] = (addr >> 24) & 0xff;
    cmd[6] = len & 0xff;
    cmd[7] = (len >> 8) & 0xff;

    // send command (no immediate response data)
    await this.usb.sendCommand(cmd, 0);

    // receive data
    const data = await this.usb.receiveData(len);

    return data;
  }

  /**
   * write 32-bit aligned memory
   */
  async writeMem32(addr: number, data: Uint8Array): Promise<void> {
    if (addr & 3) {
      throw new Error('Address must be 4-byte aligned');
    }

    const len = data.length;

    const cmd = new Uint8Array(16);
    cmd[0] = STLINK_DEBUG_COMMAND;
    cmd[1] = STLINK_DEBUG_WRITEMEM_32BIT;
    cmd[2] = addr & 0xff;
    cmd[3] = (addr >> 8) & 0xff;
    cmd[4] = (addr >> 16) & 0xff;
    cmd[5] = (addr >> 24) & 0xff;
    cmd[6] = len & 0xff;
    cmd[7] = (len >> 8) & 0xff;

    // send command
    await this.usb.sendCommand(cmd, 0);

    // send data
    await this.usb.sendData(data);
  }

  /**
   * read 16-bit aligned memory
   */
  async readMem16(addr: number, len: number): Promise<Uint8Array> {
    // must be 2-byte aligned
    if (addr & 1) {
      throw new Error('Address must be 2-byte aligned');
    }
    if (len & 1) {
      len = (len + 1) & ~1; // round up
    }

    const cmd = new Uint8Array(16);
    cmd[0] = STLINK_DEBUG_COMMAND;
    cmd[1] = STLINK_DEBUG_READMEM_16BIT;
    cmd[2] = addr & 0xff;
    cmd[3] = (addr >> 8) & 0xff;
    cmd[4] = (addr >> 16) & 0xff;
    cmd[5] = (addr >> 24) & 0xff;
    cmd[6] = len & 0xff;
    cmd[7] = (len >> 8) & 0xff;

    // send command (no immediate response data)
    await this.usb.sendCommand(cmd, 0);

    // receive data
    const data = await this.usb.receiveData(len);

    return data;
  }

  /**
   * write 16-bit aligned memory
   */
  async writeMem16(addr: number, data: Uint8Array): Promise<void> {
    if (addr & 1) {
      throw new Error('Address must be 2-byte aligned');
    }
    
    // pad to even length
    if (data.length & 1) {
      const padded = new Uint8Array(data.length + 1);
      padded.set(data);
      padded[data.length] = 0; // pad with 0
      data = padded;
    }

    const len = data.length;

    const cmd = new Uint8Array(16);
    cmd[0] = STLINK_DEBUG_COMMAND;
    cmd[1] = STLINK_DEBUG_WRITEMEM_16BIT;
    cmd[2] = addr & 0xff;
    cmd[3] = (addr >> 8) & 0xff;
    cmd[4] = (addr >> 16) & 0xff;
    cmd[5] = (addr >> 24) & 0xff;
    cmd[6] = len & 0xff;
    cmd[7] = (len >> 8) & 0xff;

    // send command
    await this.usb.sendCommand(cmd, 0);

    // send data
    await this.usb.sendData(data);
  }

  /**
   * write 8-bit memory (for unaligned writes)
   */
  async writeMem8(addr: number, data: Uint8Array): Promise<void> {
    const len = data.length;

    const cmd = new Uint8Array(16);
    cmd[0] = STLINK_DEBUG_COMMAND;
    cmd[1] = STLINK_DEBUG_WRITEMEM_8BIT;
    cmd[2] = addr & 0xff;
    cmd[3] = (addr >> 8) & 0xff;
    cmd[4] = (addr >> 16) & 0xff;
    cmd[5] = (addr >> 24) & 0xff;
    cmd[6] = len & 0xff;
    cmd[7] = (len >> 8) & 0xff;

    // send command
    await this.usb.sendCommand(cmd, 0);

    // send data
    await this.usb.sendData(data);
  }

  /**
   * read debug register
   */
  async readDebugReg(addr: number): Promise<number> {
    const cmd = new Uint8Array(16);
    cmd[0] = STLINK_DEBUG_COMMAND;
    cmd[1] = STLINK_DEBUG_APIV2_READDEBUGREG;
    cmd[2] = addr & 0xff;
    cmd[3] = (addr >> 8) & 0xff;
    cmd[4] = (addr >> 16) & 0xff;
    cmd[5] = (addr >> 24) & 0xff;

    const response = await this.usb.sendCommand(cmd, 8);
    this.checkStatus(response);

    // value is in bytes 4-7
    return (
      response[4] |
      (response[5] << 8) |
      (response[6] << 16) |
      (response[7] << 24)
    );
  }

  /**
   * write debug register
   */
  async writeDebugReg(addr: number, val: number): Promise<void> {
    const cmd = new Uint8Array(16);
    cmd[0] = STLINK_DEBUG_COMMAND;
    cmd[1] = STLINK_DEBUG_APIV2_WRITEDEBUGREG;
    cmd[2] = addr & 0xff;
    cmd[3] = (addr >> 8) & 0xff;
    cmd[4] = (addr >> 16) & 0xff;
    cmd[5] = (addr >> 24) & 0xff;
    cmd[6] = val & 0xff;
    cmd[7] = (val >> 8) & 0xff;
    cmd[8] = (val >> 16) & 0xff;
    cmd[9] = (val >> 24) & 0xff;

    const response = await this.usb.sendCommand(cmd, 2);
    this.checkStatus(response);
  }

  /**
   * read core id
   */
  async readCoreId(): Promise<number> {
    const cmd = new Uint8Array([STLINK_DEBUG_COMMAND, STLINK_DEBUG_READCOREID]);
    const response = await this.usb.sendCommand(cmd, 4);

    return (
      response[0] |
      (response[1] << 8) |
      (response[2] << 16) |
      (response[3] << 24)
    );
  }

  /**
   * get target voltage
   */
  async getTargetVoltage(): Promise<number> {
    return this.usb.getTargetVoltage();
  }

  /**
   * get underlying usb device
   */
  getUsbDevice(): USBDevice {
    return this.usb.getDevice();
  }

  /**
   * check status byte from response
   */
  private checkStatus(response: Uint8Array): void {
    if (response.length > 0 && response[0] !== 0x80) {
      const errorCode = response[0];
      throw new Error(`ST-Link error: 0x${errorCode.toString(16)}`);
    }
  }

  /**
   * delay helper
   */
  private delay(ms: number): Promise<void> {
    return new Promise((resolve) => setTimeout(resolve, ms));
  }
}
