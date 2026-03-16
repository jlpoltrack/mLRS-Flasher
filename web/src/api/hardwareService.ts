import { SERIAL_FILTERS, DFU_USB_FILTERS, SERIAL_VID_FILTERS, SERIAL_VIDPID_FILTERS } from '../constants';
import { isStlinkDevice } from './stlink';

// hardware service - manages web serial and webusb connections
// last updated: 2026-03-09

// module-level state for selected devices
let selectedPort: SerialPort | null = null;
let selectedUSBDevice: USBDevice | null = null;

export interface PortInfo {
  name: string;
  port: SerialPort;
}

export interface USBDeviceInfo {
  name: string;
  device: USBDevice;
}

// check if web serial and webusb are supported
export function isSupported(): boolean {
  return !!(navigator.serial && navigator.usb);
}

// get currently selected serial port
export function getSelectedPort(): SerialPort | null {
  return selectedPort;
}

// get currently selected usb device  
export function getSelectedUSBDevice(): USBDevice | null {
  return selectedUSBDevice;
}

// clear selected port
export function clearSelectedPort(): void {
  selectedPort = null;
}

// clear selected usb device
export function clearSelectedUSBDevice(): void {
  selectedUSBDevice = null;
}

// list all authorized serial ports
export async function listPorts(): Promise<{ ports: string[] }> {
  if (!navigator.serial) return { ports: [] };
  const ports = await navigator.serial.getPorts();
  const uniquePorts = getUniquePorts(ports);
  return { ports: uniquePorts.map(p => p.name) };
}

// request user to select a serial port
export async function requestPort(): Promise<string | null> {
  if (!navigator.serial) {
    alert('Web Serial API not supported in this browser.');
    return null;
  }
  
  try {
    // spread to mutable array to satisfy strict TS types
    selectedPort = await navigator.serial.requestPort({ filters: [...SERIAL_FILTERS] });
    
    // calculate the unique name for this newly selected port
    const allPorts = await navigator.serial.getPorts();
    const uniquePorts = getUniquePorts(allPorts);
    const match = uniquePorts.find((p) => p.port === selectedPort);
    
    return match ? match.name : formatPortName(selectedPort);
  } catch (err) {
    return null;
  }
}

// forget all authorized serial ports
export async function forgetAllPorts(): Promise<void> {
  if (!navigator.serial) return;
  const ports = await navigator.serial.getPorts();
  for (const port of ports) {
    if (port.forget) {
      await port.forget();
    }
  }
  selectedPort = null;
}

// check if a usb device is an stm32 dfu bootloader
export function isDfuDevice(device: USBDevice): boolean {
  return device.vendorId === 0x0483 && device.productId === 0xDF11;
}

// list authorized usb devices, filtered to only dfu bootloaders
export async function listUSBDevices(): Promise<{ devices: string[] }> {
  if (!navigator.usb) return { devices: [] };
  const devices = await navigator.usb.getDevices();
  // only return dfu bootloader devices, exclude st-link and other stm32 devices
  const dfuDevices = devices.filter(d => isDfuDevice(d) && !isStlinkDevice(d));
  return { devices: dfuDevices.map(formatUSBName) };
}

// request user to select a usb device (dfu bootloaders only)
export async function requestUSBDevice(): Promise<string | null> {
  if (!navigator.usb) {
    alert('WebUSB API not supported in this browser.');
    return null;
  }
  try {
    // use dfu-specific filter so browser picker only shows dfu bootloaders
    selectedUSBDevice = await navigator.usb.requestDevice({ filters: [...DFU_USB_FILTERS] });
    return formatUSBName(selectedUSBDevice);
  } catch (err) {
    return null;
  }
}

// find a serial port by its unique display name
export async function findPortByName(name: string): Promise<SerialPort | null> {
  if (!navigator.serial) return null;
  const allPorts = await navigator.serial.getPorts();
  const uniquePorts = getUniquePorts(allPorts);
  const match = uniquePorts.find(p => p.name === name);
  return match?.port || null;
}

// find a usb device by its display name
export async function findUSBDeviceByName(name: string): Promise<USBDevice | null> {
  if (!navigator.usb) return null;
  const devices = await navigator.usb.getDevices();
  return devices.find(d => formatUSBName(d) === name) || null;
}

// helper to generate unique names for ports when duplicates exist
export function getUniquePorts(ports: SerialPort[]): PortInfo[] {
  const frequency = new Map<string, number>();
  for (const port of ports) {
    const name = formatPortName(port);
    frequency.set(name, (frequency.get(name) || 0) + 1);
  }

  const currentCounts = new Map<string, number>();
  return ports.map(port => {
    const baseName = formatPortName(port);
    const total = frequency.get(baseName) || 0;
    
    if (total > 1) {
      const count = (currentCounts.get(baseName) || 0) + 1;
      currentCounts.set(baseName, count);
      return { name: `${baseName} (${count})`, port };
    } else {
      return { name: baseName, port };
    }
  });
}

// format a serial port for display
export function formatPortName(port: SerialPort): string {
  const info = port.getInfo();
  
  const extraKeys = Object.keys(info).filter(k => k !== 'usbVendorId' && k !== 'usbProductId');

  const vid = info.usbVendorId ? info.usbVendorId.toString(16).padStart(4, '0').toUpperCase() : '????';
  const pid = info.usbProductId ? info.usbProductId.toString(16).padStart(4, '0').toUpperCase() : '????';
  
  let label = "Serial Device";
  if (info.usbVendorId === 0x0483 && info.usbProductId === 0x5740) label = "EdgeTX/OpenTX";
  else if (info.usbVendorId === 0x0483 && info.usbProductId === 0x374E) label = "ST-Link";
  else if (info.usbVendorId === 0x1209) label = "ArduPilot";
  
  let display = `${label} (VID:${vid} PID:${pid})`;
  
  if (extraKeys.length > 0) {
    display += ` [${extraKeys.map(k => `${k}: ${(info as any)[k]}`).join(' ')}]`;
  }

  return display;
}

// filter serial ports by flash method using VID/PID rules
export function filterPortsByMethod(ports: string[], allPorts: SerialPort[], flashMethod: string): string[] {
  const vidFilter = SERIAL_VID_FILTERS[flashMethod];
  const vidPidFilter = SERIAL_VIDPID_FILTERS[flashMethod];
  
  // if no filter defined for this method, return all ports
  if (!vidFilter && !vidPidFilter) return ports;
  
  const uniquePorts = getUniquePorts(allPorts);
  
  return ports.filter(portName => {
    const match = uniquePorts.find(p => p.name === portName);
    if (!match) return false;
    
    const info = match.port.getInfo();
    const vid = info.usbVendorId;
    const pid = info.usbProductId;
    
    if (vid === undefined) return false;
    
    // if vidpid filter exists for this method, use exact match
    if (vidPidFilter) {
      return vidPidFilter.some(f => f.vid === vid && f.pid === pid);
    }
    
    // otherwise match by vid only
    return vidFilter.includes(vid);
  });
}

// format a usb device for display
export function formatUSBName(device: USBDevice): string {
  const vid = device.vendorId.toString(16).padStart(4, '0').toUpperCase();
  const pid = device.productId.toString(16).padStart(4, '0').toUpperCase();
  
  if (device.vendorId === 0x0483) {
    if (pid === '3748' || pid === '374B' || pid === '374A' || pid === '374E' || pid === '374F' || pid === '3753' || pid === '3754') {
      return `ST-Link V2/V3 (${vid}:${pid})`;
    }
    if (pid === 'DF11') {
      return `STM32 Bootloader (DFU) (${vid}:${pid})`;
    }
  }
  
  return `USB Device (${vid}:${pid})`;
}
