// low-level webusb communication layer for st-link
// date: 2026-01-14

import {
  STLINK_CMD_SIZE,
  STLINK_GET_VERSION,
  STLINK_GET_CURRENT_MODE,
  STLINK_GET_TARGET_VOLTAGE,
  STLINK_GET_VERSION_APIV3,
} from './stlinkCommands';
import type { StlinkVersion, LogCallback } from './types';
import { StlinkMode } from './types';

// default timeout for usb transfers (ms)
const USB_TRANSFER_TIMEOUT = 5000;

/**
 * wrap a promise with a timeout
 */
function withTimeout<T>(promise: Promise<T>, ms: number, operation: string): Promise<T> {
  return Promise.race([
    promise,
    new Promise<never>((_, reject) =>
      setTimeout(() => reject(new Error(`USB ${operation} timeout after ${ms}ms`)), ms)
    ),
  ]);
}

// st-link usb vendor id
export const STLINK_VID = 0x0483;

// st-link usb product ids
export const STLINK_USB_PIDS = {
  // v1
  V1: 0x3744,
  // v2
  V2: 0x3748,
  V2_AUDIO: 0x374a,
  V2_NUCLEO: 0x374b,
  // v2.1
  V21: 0x374b,
  V21_BRIDGE: 0x374e,
  V21_AUDIO: 0x374a,
  V21_MSD: 0x3752,
  // v3
  V3_USBLOADER: 0x374d,
  V3E: 0x374e,
  V3S: 0x374f,
  V3_2VCP: 0x3753,
  V3_NO_MSD: 0x3754,
  V3P: 0x3755,
};

// all supported pids for webusb filter
export const STLINK_SUPPORTED_PIDS = [
  STLINK_USB_PIDS.V1,
  STLINK_USB_PIDS.V2,
  STLINK_USB_PIDS.V2_NUCLEO,
  STLINK_USB_PIDS.V21_BRIDGE,
  STLINK_USB_PIDS.V21_MSD,
  STLINK_USB_PIDS.V3_USBLOADER,
  STLINK_USB_PIDS.V3E,
  STLINK_USB_PIDS.V3S,
  STLINK_USB_PIDS.V3_2VCP,
  STLINK_USB_PIDS.V3_NO_MSD,
  STLINK_USB_PIDS.V3P,
];

// webusb request filters for st-link devices
export function getStlinkFilters(): USBDeviceRequestOptions {
  return {
    filters: STLINK_SUPPORTED_PIDS.map((pid) => ({
      vendorId: STLINK_VID,
      productId: pid,
    })),
  };
}

// check if a usb device is an st-link
export function isStlinkDevice(device: USBDevice): boolean {
  return (
    device.vendorId === STLINK_VID &&
    STLINK_SUPPORTED_PIDS.includes(device.productId)
  );
}

// determine st-link version from pid
export function getStlinkVersionFromPid(pid: number): number {
  if (pid === STLINK_USB_PIDS.V1) return 1;
  if (
    pid === STLINK_USB_PIDS.V3_USBLOADER ||
    pid === STLINK_USB_PIDS.V3E ||
    pid === STLINK_USB_PIDS.V3S ||
    pid === STLINK_USB_PIDS.V3_2VCP ||
    pid === STLINK_USB_PIDS.V3_NO_MSD ||
    pid === STLINK_USB_PIDS.V3P
  ) {
    return 3;
  }
  return 2; // v2 or v2.1
}

/**
 * low-level webusb communication class for st-link programmers
 */
export class StlinkUsb {
  private device: USBDevice;
  private epIn: USBEndpoint | null = null;
  private epOut: USBEndpoint | null = null;
  private epTrace: USBEndpoint | null = null;
  private interfaceNumber = 0;
  private log: LogCallback;

  constructor(device: USBDevice, log?: LogCallback) {
    this.device = device;
    this.log = log || (() => {});
  }

  /**
   * open connection to st-link device
   */
  async open(): Promise<void> {
    this.log('debug', `Opening ST-Link device: ${this.device.productName}`);

    await this.device.open();

    // find the correct interface and endpoints
    // st-link v2/v3 use interface 0 with bulk endpoints
    const config = this.device.configuration;
    if (!config) {
      await this.device.selectConfiguration(1);
    }

    // find bulk endpoints
    const iface = this.device.configuration?.interfaces[0];
    if (!iface) {
      throw new Error('No USB interface found');
    }

    this.interfaceNumber = iface.interfaceNumber;

    // claim the interface
    await this.device.claimInterface(this.interfaceNumber);

    // find endpoints - typically alternate 0
    const alternate = iface.alternates[0];
    for (const ep of alternate.endpoints) {
      if (ep.type === 'bulk') {
        if (ep.direction === 'in') {
          if (!this.epIn) {
            this.epIn = ep;
          } else if (!this.epTrace) {
            this.epTrace = ep; // second in endpoint is trace
          }
        } else {
          this.epOut = ep;
        }
      }
    }

    if (!this.epIn || !this.epOut) {
      throw new Error('Required bulk endpoints not found');
    }

    this.log(
      'debug',
      `Endpoints: OUT=${this.epOut.endpointNumber}, IN=${this.epIn.endpointNumber}`
    );
  }

  /**
   * close connection to st-link device
   */
  async close(): Promise<void> {
    this.log('debug', 'Closing ST-Link device');
    try {
      await this.device.releaseInterface(this.interfaceNumber);
      await this.device.close();
    } catch (e) {
      this.log('warn', `Error closing device: ${e}`);
    }
  }

  /**
   * send a command and receive response
   */
  async sendCommand(cmd: Uint8Array, rxLen: number): Promise<Uint8Array> {
    if (!this.epIn || !this.epOut) {
      throw new Error('Device not opened');
    }

    // pad command to fixed size
    const cmdBuf = new Uint8Array(STLINK_CMD_SIZE);
    cmdBuf.set(cmd.slice(0, STLINK_CMD_SIZE));

    // send command with timeout protection
    const outResult = await withTimeout(
      this.device.transferOut(this.epOut.endpointNumber, cmdBuf),
      USB_TRANSFER_TIMEOUT,
      'command out'
    );
    if (outResult.status !== 'ok') {
      throw new Error(`USB transfer out failed: ${outResult.status}`);
    }

    // receive response if expected
    if (rxLen > 0) {
      const inResult = await withTimeout(
        this.device.transferIn(this.epIn.endpointNumber, rxLen),
        USB_TRANSFER_TIMEOUT,
        'command in'
      );
      if (inResult.status !== 'ok') {
        throw new Error(`USB transfer in failed: ${inResult.status}`);
      }
      if (inResult.data) {
        return new Uint8Array(inResult.data.buffer);
      }
    }

    return new Uint8Array(0);
  }

  /**
   * send data (for write operations)
   */
  async sendData(data: Uint8Array): Promise<void> {
    if (!this.epOut) {
      throw new Error('Device not opened');
    }

    // create a new ArrayBuffer copy to satisfy BufferSource type
    const buffer = new ArrayBuffer(data.length);
    new Uint8Array(buffer).set(data);
    
    const result = await withTimeout(
      this.device.transferOut(this.epOut.endpointNumber, buffer),
      USB_TRANSFER_TIMEOUT,
      'data out'
    );
    if (result.status !== 'ok') {
      throw new Error(`USB data transfer out failed: ${result.status}`);
    }
  }

  /**
   * receive data (for read operations)
   */
  async receiveData(len: number): Promise<Uint8Array> {
    if (!this.epIn) {
      throw new Error('Device not opened');
    }

    const result = await withTimeout(
      this.device.transferIn(this.epIn.endpointNumber, len),
      USB_TRANSFER_TIMEOUT,
      'data in'
    );
    if (result.status !== 'ok') {
      throw new Error(`USB data transfer in failed: ${result.status}`);
    }
    if (result.data) {
      return new Uint8Array(result.data.buffer);
    }
    return new Uint8Array(0);
  }

  /**
   * get st-link version information
   */
  async getVersion(): Promise<StlinkVersion> {
    const hwVersion = getStlinkVersionFromPid(this.device.productId);

    if (hwVersion === 3) {
      // v3 uses different version command
      return this.getVersionV3();
    }

    // v1/v2 version command
    const cmd = new Uint8Array([STLINK_GET_VERSION]);
    const data = await this.sendCommand(cmd, 6);

    // parse version bytes
    // bytes 0-1: version (big endian)
    const version = (data[0] << 8) | data[1];
    const stlinkV = (version >> 12) & 0x0f;
    const jtagV = (version >> 6) & 0x3f;
    const swimV = version & 0x3f;

    // bytes 2-3: vid (little endian)
    const vid = data[2] | (data[3] << 8);
    // bytes 4-5: pid (little endian)
    const pid = data[4] | (data[5] << 8);

    // determine api version based on jtag version
    let apiVersion: 1 | 2 | 3 = 1;
    if (jtagV >= 11) apiVersion = 2;
    if (jtagV >= 32) apiVersion = 3;

    // determine capability flags
    let flags = 0;
    if (jtagV >= 13) flags |= 1; // has trace
    if (jtagV >= 15) flags |= 2; // has get_last_rw_status2
    if (jtagV >= 22) flags |= 4; // has dap reg
    if (jtagV >= 26) flags |= 0x200; // has rw8_512bytes

    const result: StlinkVersion = {
      stlinkV,
      jtagV,
      swimV,
      vid,
      pid,
      apiVersion,
      flags,
    };

    this.log(
      'info',
      `ST-Link V${stlinkV} JTAG:${jtagV} SWIM:${swimV} API:${apiVersion}`
    );

    return result;
  }

  /**
   * get st-link v3 version information
   */
  private async getVersionV3(): Promise<StlinkVersion> {
    const cmd = new Uint8Array([STLINK_GET_VERSION_APIV3]);
    const data = await this.sendCommand(cmd, 12);

    const stlinkV = data[0];
    const swimV = data[1];
    const jtagV = data[2];
    // data[3] is msd version
    // data[4] is bridge version
    const vid = data[8] | (data[9] << 8);
    const pid = data[10] | (data[11] << 8);

    // v3 always uses api v3
    const apiVersion: 1 | 2 | 3 = 3;

    // v3 has all capabilities
    const flags = 0x3ff;

    const result: StlinkVersion = {
      stlinkV,
      jtagV,
      swimV,
      vid,
      pid,
      apiVersion,
      flags,
    };

    this.log(
      'info',
      `ST-Link V${stlinkV} JTAG:${jtagV} SWIM:${swimV} API:${apiVersion}`
    );

    return result;
  }

  /**
   * get current device mode
   */
  async getCurrentMode(): Promise<number> {
    const cmd = new Uint8Array([STLINK_GET_CURRENT_MODE]);
    const data = await this.sendCommand(cmd, 2);

    const mode = data[0];
    // find mode name for logging
    const modeName = Object.entries(StlinkMode).find(([, v]) => v === mode)?.[0] ?? String(mode);
    this.log('debug', `Current mode: ${modeName}`);

    return mode;
  }

  /**
   * get target voltage
   */
  async getTargetVoltage(): Promise<number> {
    const cmd = new Uint8Array([STLINK_GET_TARGET_VOLTAGE]);
    const data = await this.sendCommand(cmd, 8);

    // data is two 32-bit values (little endian)
    const adc1 =
      data[0] | (data[1] << 8) | (data[2] << 16) | (data[3] << 24);
    const adc2 =
      data[4] | (data[5] << 8) | (data[6] << 16) | (data[7] << 24);

    if (adc1 === 0) {
      return 0;
    }

    // voltage calculation: 2 * adc2 * 1.2 / adc1
    const voltage = (2 * adc2 * 1.2) / adc1;
    this.log('debug', `Target voltage: ${voltage.toFixed(2)}V`);

    return voltage;
  }

  /**
   * get the underlying usb device
   */
  getDevice(): USBDevice {
    return this.device;
  }
}

/**
 * request an st-link device from the user via webusb
 */
export async function requestStlinkDevice(): Promise<USBDevice | null> {
  try {
    if (!navigator.usb) {
      console.warn('WebUSB not supported in this browser');
      return null;
    }
    const device = await navigator.usb.requestDevice(getStlinkFilters());
    return device;
  } catch (e) {
    // user cancelled or no device selected
    return null;
  }
}

/**
 * get already-paired st-link devices
 */
export async function getPairedStlinkDevices(): Promise<USBDevice[]> {
  if (!navigator.usb) return [];
  const devices = await navigator.usb.getDevices();
  return devices.filter(isStlinkDevice);
}
