// web serial api - orchestration layer for flashing and downloads
// 2026-03-17

import { githubApi } from './githubApi';
import { flash } from './flasher';
import type { FlasherOptions } from './flasher';
import type { FirmwareFile } from '../types';
import {
  getSelectedPort,
  getSelectedUSBDevice,
  findPortByName,
  findUSBDeviceByName,
} from './hardwareService';

let outputCallback: ((data: any) => void) | null = null;

export const api = {
  // GitHub Data Layer - pass-through to githubApi
  listVersions: async () => {
    const versions = await githubApi.listVersions();
    return { versions };
  },
  
  listDevices: async (type: string) => {
    const devices = await githubApi.listDevices(type);
    return { devices };
  },
  
  listFirmware: async (options: { type: string, device?: string, version: string, luaFolder?: string }) => {
    return githubApi.listFirmware(options);
  },
  
  getMetadata: async (options: { type: string, device: string, filename: string }) => {
    return githubApi.getMetadata(options);
  },
  
  listWirelessBridgeFirmware: async (options: { version: string, chipset: string }) => {
    return githubApi.listWirelessBridgeFirmware(options);
  },

  // update check
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
    // web app uses browser downloads instead of directory picker
    return 'Web Downloads';
  },

  downloadLua: async (options: { version: string, filename: string | null }): Promise<void> => {
    const { version, filename } = options;
    outputCallback?.({ type: 'info', message: `Downloading Lua script(s) for ${version}...` });
    
    try {
      const filesRes = await githubApi.listFirmware({ type: 'lua', version });
      const files: FirmwareFile[] = filesRes.files;
      const filesToDownload = filename ? files.filter(f => f.filename === filename) : files;
      
      if (filesToDownload.length === 0) {
        throw new Error("No Lua files found to download");
      }

      for (const file of filesToDownload) {
        outputCallback?.({ type: 'info', message: `Downloading ${file.filename}...` });
        outputCallback?.({ type: 'info', message: `Target filename: ${file.filename}` });
        const response = await fetch(file.url);
        const initialBlob = await response.blob();
        
        const blob = new Blob([initialBlob], { type: 'application/octet-stream' });
        const url = window.URL.createObjectURL(blob);
        
        // trigger browser download
        const a = document.createElement('a');
        a.href = url;
        a.download = file.filename;
        a.target = '_blank';
        a.style.position = 'absolute';
        a.style.left = '-9999px';
        
        document.body.appendChild(a);
        a.click();
        
        // delay cleanup to ensure browser captures the download
        setTimeout(() => {
          window.URL.revokeObjectURL(url);
          document.body.removeChild(a);
        }, 1000);
      }
      outputCallback?.({ type: 'success', message: 'Download complete! Please check your browser downloads.' });
    } catch (err: any) {
      outputCallback?.({ type: 'error', message: `Failed to download Lua: ${err.message}` });
      throw err;
    }
  },

  // flashing orchestration
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
    passthroughIdentifier?: number,
    baudrate?: number,
    target?: string,
    reset?: string,
    url?: string,
    erase?: string,
    activationBaud?: number,
    chipset?: string
  }): Promise<void> => { 
    const { type, device, filename } = options;

    // in local file mode (firmwareData provided), infer chipset from flash method
    // instead of fetching metadata for a possibly stale device selection
    let chipset: string;
    let metadata: any = null;
    if (options.firmwareData) {
      // use explicit chipset if provided (e.g. local file mode with mcu selector)
      if (options.chipset) {
        chipset = options.chipset;
      } else {
        chipset = options.flashMethod === 'esptool' ? 'esp32' : 'stm32';
      }
    } else {
      metadata = await githubApi.getMetadata({ type, device, filename });
      if (!metadata) {
        throw new Error(`Device not found in database: ${device}`);
      }
      chipset = (metadata.chipset as string) || 'stm32';
    }

    const flashmethod = options.flashMethod || (metadata?.raw_flashmethod as string) || '';
    
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
      erase: options.erase || (metadata?.isWirelessBridgeFirmware ? metadata.wireless?.erase : metadata?.erase),
      device: options.device,
      flashMethod: options.flashMethod,
      passthroughSerial: options.passthroughSerial,
      passthroughIdentifier: options.passthroughIdentifier,
      activationBaud: options.activationBaud,
      isWirelessBridge: !!metadata?.isWirelessBridgeFirmware,
      isLocalFile: !!options.firmwareData
    };

    // fetch firmware data if not provided
    let data = options.firmwareData;
    if (!data) {
      if (options.url) {
        const { onLog } = flasherOptions;
        onLog?.(`Downloading firmware from ${options.url}...`);
        const response = await fetch(options.url);
        data = await response.arrayBuffer();
      } else {
        const { version } = options;
        const { onLog } = flasherOptions;
        
        onLog?.(`Searching for firmware ${filename} for ${device} (${version})...`);
        const firmwareFiles = await githubApi.listFirmware({ type, device, version });
        
        onLog?.(`Found ${firmwareFiles.files.length} candidate files.`);
        const file = firmwareFiles.files.find(f => f.filename === filename);
        
        if (!file) {
          throw new Error(`Firmware file not found: ${filename}`);
        }
        
        onLog?.(`Downloading firmware from ${file.url}...`);
        const response = await fetch(file.url);
        data = await response.arrayBuffer();
      }
    }

    if (chipset === 'stm32' && (flashmethod === 'dfu' || flashmethod === 'stlink')) {
      // for USB-based methods (DFU, ST-Link), port argument might already be the USBDevice object
      if (options.port && typeof options.port !== 'string' && 'vendorId' in (options.port as any)) {
          return flash(options.port as unknown as USBDevice, data, flasherOptions);
      }

      // use selected usb device or find by name
      const activeDevice = getSelectedUSBDevice() || await findUSBDeviceByName(options.usbDeviceName || '');
      if (!activeDevice) {
          const methodLabel = flashmethod === 'stlink' ? 'ST-Link' : 'DFU';
          throw new Error(`No USB device selected for ${methodLabel}. Please click 'Add Device' to authorize.`);
      }
      return flash(activeDevice, data, flasherOptions);
    } else {
      // use selected port or find by name
      const activePort = getSelectedPort() || await findPortByName(options.port || '');
      if (!activePort) throw new Error(`No serial port selected or found matching "${options.port}". Please select a port first.`);
      return flash(activePort, data, flasherOptions);
    }
  },
  
  // TODO: implement flash cancellation for web version (e.g. abort the serial write loop)
  cancelPython: async (): Promise<void> => { 
    console.warn('cancel requested but not yet implemented in web version');
    outputCallback?.({ type: 'info', message: 'Cancel is not yet supported in the web version.' });
  },
  
  onOutput: (callback: (data: any) => void) => {
    outputCallback = callback;
    return () => { outputCallback = null; };
  },
  
  onComplete: (_callback: (data: any) => void) => {
    return () => {};
  },
};
