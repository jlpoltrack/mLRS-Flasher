import { githubApi } from './githubApi';
import { flash } from './flasher';
import type { FlasherOptions } from './flasher';

let selectedPort: any = null;
let selectedUSBDevice: any = null;
let outputCallback: ((data: any) => void) | null = null;

export const api = {
  // GitHub Data Layer (Phase 2)
  listVersions: async () => {
    const versions = await githubApi.listVersions();
    return { versions };
  },
  listDevices: async (type: string) => {
    const devices = await githubApi.listDevices(type);
    return { devices };
  },
  listFirmware: async (options: { type: string, device?: string, version: string }) => {
    return githubApi.listFirmware(options);
  },
  getMetadata: async (options: { type: string, device: string, filename: string }) => {
    return githubApi.getMetadata(options);
  },

  // Stub for update check (Phase 2 polish)
  checkForUpdates: async () => {
    try {
      const response = await fetch('https://api.github.com/repos/jlpoltrack/mLRS-Flasher/releases/latest');
      if (!response.ok) return { updateAvailable: false, latestVersion: '', releaseUrl: '' };
      const data = await response.json();
      return { 
        updateAvailable: false, 
        latestVersion: data.tag_name || '', 
        releaseUrl: data.html_url || '' 
      };
    } catch (e) {
      return { updateAvailable: false, latestVersion: '', releaseUrl: '' };
    }
  },

  pickDirectory: async (): Promise<string | null> => {
    // In a web app, we can't really "pick a directory" for file system access the same way Electron does.
    // We will likely use the File System Access API or just download as a zip/blobs.
    return 'Web Downloads';
  },

  downloadLua: async (options: any): Promise<void> => {
    console.log('Download Lua logic to be implemented', options);
  },
  
  // Web Serial Implementation (Phase 1)
  listPorts: async (): Promise<{ ports: string[] }> => {
    // @ts-ignore
    if (!navigator.serial) return { ports: [] };
    // @ts-ignore
    const ports = await navigator.serial.getPorts();
    return { ports: ports.map(formatPortName) };
  },

  requestPort: async (): Promise<string | null> => {
    if (!navigator.serial) {
      alert('Web Serial API not supported in this browser.');
      return null;
    }
    try {
      selectedPort = await navigator.serial.requestPort();
      return formatPortName(selectedPort);
    } catch (err) {
      return null;
    }
  },

  requestUSBDevice: async (): Promise<string | null> => {
    if (!navigator.usb) {
      alert('WebUSB API not supported in this browser.');
      return null;
    }
    try {
      selectedUSBDevice = await navigator.usb.requestDevice({
        filters: [{ vendorId: 0x0483 }] // STM32 Vendor ID
      });
      return `USB Device (${selectedUSBDevice.vendorId.toString(16).padStart(4, '0')}:${selectedUSBDevice.productId.toString(16).padStart(4, '0')})`;
    } catch (err) {
      return null;
    }
  },

  // Flashing logic (Phase 3)
  flash: async (options: { 
    type: string, 
    device: string, 
    filename: string, 
    version: string,
    firmwareData?: ArrayBuffer // Web app might pass data directly or we fetch it
  }): Promise<void> => { 
    const { type, device, filename } = options;
    const { targetDict } = await githubApi.getMetadata({ type, device, filename });
    const chipset = targetDict.chipset || 'stm32';
    
    // Determine if we need to fetch firmware data first
    let data = options.firmwareData;
    if (!data) {
        // Fetch from GitHub
        const firmwareFiles = await githubApi.listFirmware({ type, device, version: options.version });
        const file = firmwareFiles.files.find(f => f.filename === filename);
        if (!file) throw new Error("Firmware file not found");
        
        const response = await fetch(file.url);
        data = await response.arrayBuffer();
    }

    const flasherOptions: FlasherOptions = {
        chipset,
        onProgress: (progress, status) => {
            outputCallback?.({ type: 'progress', progress, status });
        },
        onLog: (message) => {
            outputCallback?.({ type: 'log', message });
        }
    };

    if (chipset === 'stm32' && targetDict.flashmethod === 'dfu') {
        if (!selectedUSBDevice) throw new Error("No USB device selected for DFU");
        return flash(selectedUSBDevice, data, flasherOptions);
    } else {
        if (!selectedPort) throw new Error("No serial port selected");
        return flash(selectedPort, data, flasherOptions);
    }
  },
  
  cancelPython: async (): Promise<void> => { 
    console.log('Cancel requested'); 
  },
  
  onOutput: (callback: (data: any) => void) => {
    outputCallback = callback;
    return () => { outputCallback = null; };
  },
  onComplete: (_callback: (data: any) => void) => {
    return () => {};
  },
};

function formatPortName(port: any): string {
  const info = port.getInfo();
  const vid = info.usbVendorId ? info.usbVendorId.toString(16).padStart(4, '0') : '????';
  const pid = info.usbProductId ? info.usbProductId.toString(16).padStart(4, '0') : '????';
  return `USB Device (${vid}:${pid})`;
}
