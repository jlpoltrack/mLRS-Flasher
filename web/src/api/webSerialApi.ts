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

  downloadLua: async (options: { version: string, filename: string | null }): Promise<void> => {
    const { version, filename } = options;
    outputCallback?.({ type: 'info', message: `Downloading Lua script(s) for ${version}...` });
    
    try {
      const files = await githubApi.listFirmware({ type: 'lua', version });
      const filesToDownload = filename ? files.files.filter(f => f.filename === filename) : files.files;
      
      if (filesToDownload.length === 0) {
        throw new Error("No Lua files found to download");
      }

      for (const file of filesToDownload) {
          outputCallback?.({ type: 'info', message: `Downloading ${file.filename}...` });
          const response = await fetch(file.url);
          const blob = await response.blob();
          
          // Trigger browser download
          const url = window.URL.createObjectURL(blob);
          const a = document.createElement('a');
          a.style.display = 'none';
          a.href = url;
          a.download = file.filename;
          document.body.appendChild(a);
          a.click();
          window.URL.revokeObjectURL(url);
          document.body.removeChild(a);
      }
      
      outputCallback?.({ type: 'success', message: 'Download complete! Please check your browser downloads.' });
    } catch (err: any) {
      outputCallback?.({ type: 'error', message: `Failed to download Lua: ${err.message}` });
      throw err;
    }
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

  listUSBDevices: async (): Promise<{ devices: string[] }> => {
    if (!navigator.usb) return { devices: [] };
    const devices = await navigator.usb.getDevices();
    return { devices: devices.map(formatUSBName) };
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
      return formatUSBName(selectedUSBDevice);
    } catch (err) {
      return null;
    }
  },

  // Flashing logic (Phase 3)
  flash: async (options: { 
    filename: string, 
    version: string,
    port?: string,
    usbDeviceName?: string,
    firmwareData?: ArrayBuffer,
    type: string, // Added type
    device: string, // Added device
    flashMethod?: string, // Added flashMethod
    baudrate?: number, // Added baudrate
    target?: string // Added target
  }): Promise<void> => { 
    const { type, device, filename } = options;
    const metadata = await githubApi.getMetadata({ type, device, filename });
    const chipset = metadata.chipset || 'stm32';
    const flashmethod = metadata.raw_flashmethod || 'stlink';
    
    const flasherOptions: FlasherOptions = {
        chipset,
        targetType: type,
        onProgress: (progress, status) => {
            outputCallback?.({ type: 'progress', progress, status });
        },
        onLog: (message) => {
            outputCallback?.({ type: 'log', message });
        },
        filename: options.filename
    };

    // Determine if we need to fetch firmware data first
    let data = options.firmwareData;
    if (!data) {
        // Fetch from GitHub
        const { version } = options;
        const { onLog } = flasherOptions;
        
        onLog?.(`Searching for firmware ${filename} for ${device} (${version})...`);
        const firmwareFiles = await githubApi.listFirmware({ type, device, version });
        
        onLog?.(`Found ${firmwareFiles.files.length} candidate files.`);
        const file = firmwareFiles.files.find(f => f.filename === filename);
        
        if (!file) {
            console.log('Available files:', firmwareFiles.files.map(f => f.filename));
            throw new Error(`Firmware file not found: ${filename}`);
        }
        
        onLog?.(`Downloading firmware from ${file.url}...`);
        const response = await fetch(file.url);
        data = await response.arrayBuffer();
    }

    if (chipset === 'stm32' && flashmethod === 'dfu') {
        const activeDevice = selectedUSBDevice || (await navigator.usb.getDevices()).find(d => formatUSBName(d) === options.usbDeviceName);
        if (!activeDevice) throw new Error("No USB device selected for DFU. Please click 'Add Device' to authorize.");
        return flash(activeDevice, data, flasherOptions);
    } else {
        const activePort = selectedPort || (await (navigator as any).serial.getPorts()).find((p: any) => formatPortName(p) === options.port);
        if (!activePort) throw new Error("No serial port selected. Please select a port first.");
        return flash(activePort, data, flasherOptions);
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
  const vid = info.usbVendorId ? info.usbVendorId.toString(16).padStart(4, '0').toUpperCase() : '????';
  const pid = info.usbProductId ? info.usbProductId.toString(16).padStart(4, '0').toUpperCase() : '????';
  return `Serial Port (${vid}:${pid})`;
}

function formatUSBName(device: any): string {
  const vid = device.vendorId.toString(16).padStart(4, '0').toUpperCase();
  const pid = device.productId.toString(16).padStart(4, '0').toUpperCase();
  return `USB DFU (${vid}:${pid})`;
}
