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
  listWirelessBridgeFirmware: async (options: { version: string, chipset: string }) => {
    return githubApi.listWirelessBridgeFirmware(options);
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
          outputCallback?.({ type: 'info', message: `Target filename: ${file.filename}` });
          const response = await fetch(file.url);
                                        const initialBlob = await response.blob();
                                        console.log(`Blob size for ${file.filename}: ${initialBlob.size} bytes`);
                                        
                                        const blob = new Blob([initialBlob], { type: 'application/octet-stream' });
                                        const url = window.URL.createObjectURL(blob);
                                        
                                        // Trigger browser download
                                        const a = document.createElement('a');
                                        a.href = url;
                                        a.download = file.filename;
                                        a.target = '_blank'; // Helpful for some browsers
                                        // Make it visible but invisible
                                        a.style.position = 'absolute';
                                        a.style.left = '-9999px';
                                        
                                        document.body.appendChild(a);
                                        a.click();
                                        
                                        // Delay cleanup to ensure browser captures the download
                                        setTimeout(() => {
                                          window.URL.revokeObjectURL(url);
                                          document.body.removeChild(a);
                                        }, 1000); // Increased timeout to 1s to be safe
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
    
    // Request port with filters
    try {
      const filters = [
        { usbVendorId: 0x0483, usbProductId: 0x5740 }, // EdgeTX/OpenTX
        { usbVendorId: 0x0483, usbProductId: 0x374E }, // ST-Link
        { usbVendorId: 0x1209 },                       // ArduPilot
        { usbVendorId: 0x10C4 },                       // CP210x (Silicon Labs)
        { usbVendorId: 0x0403 },                       // FTDI
        { usbVendorId: 0x1A86 },                       // CH340 (WCH)
      ];
      
      selectedPort = await navigator.serial.requestPort({ filters });
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
    type: string,
    device: string,
    flashMethod?: string,
    passthroughSerial?: string,
    baudrate?: number,
    target?: string,
    reset?: string,
    url?: string,
    erase?: string // Added erase
  }): Promise<void> => { 
    const { type, device, filename } = options;
    const metadata = await githubApi.getMetadata({ type, device, filename });
    const chipset = metadata.chipset || 'stm32';
    const flashmethod = options.flashMethod || metadata.raw_flashmethod || '';
    
    const flasherOptions: FlasherOptions = {
        chipset,
        targetType: type,
        onProgress: (progress, status) => {
            outputCallback?.({ type: 'progress', progress, status });
        },
        onLog: (message) => {
            outputCallback?.({ type: 'log', message });
        },
        filename: options.filename,
        reset: options.reset,
        baud: options.baudrate,
        erase: options.erase || (metadata.isWirelessBridgeFirmware ? metadata.wireless?.erase : metadata.erase) || undefined,
        device: options.device,
        flashMethod: options.flashMethod,
        passthroughSerial: options.passthroughSerial
    };

    // Determine if we need to fetch firmware data first
    let data = options.firmwareData;
    if (!data) {
        // Use provided URL if available (e.g. for wireless bridge)
        if (options.url) {
             const { onLog } = flasherOptions;
             onLog?.(`Downloading firmware from ${options.url}...`);
             const response = await fetch(options.url);
             data = await response.arrayBuffer();
        } else {
             // Fetch from GitHub via lookup
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
  
  let label = `Serial Port (${vid}:${pid})`;
  
  if (info.usbVendorId === 0x0483 && info.usbProductId === 0x5740) {
      label += " - EdgeTX/OpenTX";
  } else if (info.usbVendorId === 0x0483 && info.usbProductId === 0x374E) {
      label += " - ST-Link";
  } else if (info.usbVendorId === 0x1209) {
      label += " - ArduPilot";
  }
  
  return label;
}

function formatUSBName(device: any): string {
  const vid = device.vendorId.toString(16).padStart(4, '0').toUpperCase();
  const pid = device.productId.toString(16).padStart(4, '0').toUpperCase();
  return `USB DFU (${vid}:${pid})`;
}
