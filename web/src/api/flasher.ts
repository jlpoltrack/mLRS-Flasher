// 2026-03-17
import { ESPLoader, Transport, type Before } from 'esptool-js';
import { DFU, DFUse } from 'webdfu';

import { initArduPilotPassthrough } from './ardupilotPassthrough';
import { InavPassthroughService } from './inavPassthrough';
import { FlasherStateMachine } from './flasherStateMachine';
import { parseHex } from './hexParser';
import { getPageSize, isKnownChip, FLASH_BASE, MAX_FLASH_SIZE } from './chipConstants';
import { Stm32UartProtocol } from './stm32UartProtocol';
import { StlinkDevice, FlashOperations } from './stlink';


const resolveAssetPath = (path: string) => {
  const base = import.meta.env.BASE_URL || '/';
  // If path starts with /, remove it to avoid double slash if base ends with /
  const cleanPath = path.startsWith('/') ? path.substring(1) : path;
  return base.endsWith('/') ? `${base}${cleanPath}` : `${base}/${cleanPath}`;
};

export interface FlasherOptions {
  chipset: string;
  baud?: number;
  reset?: string;
  erase?: string;
  onProgress?: (progress: number, status: string) => void;
  onLog?: (message: string) => void;
  targetType?: string; // rx, tx, txint
  filename?: string;
  device?: string;
  flashMethod?: string;
  passthroughSerial?: string;
  passthroughIdentifier?: number; // UART Index for INAV Passthrough
  activationBaud?: number; // Baud rate used for activation/reboot on STM32
  isWirelessBridge?: boolean; // external tx wireless bridge mode
  isLocalFile?: boolean; // true when flashing a user-selected local file
}

export async function flash(
  port: SerialPort | USBDevice,
  firmwareData: ArrayBuffer,
  options: FlasherOptions
): Promise<void> {
  const { chipset, onLog, flashMethod } = options;

  onLog?.(`Starting flash process for chipset: ${chipset}...`);

  if (chipset === 'stm32') {
    // In mLRS, 'stm32' can be DFU or UART depending on the target.
    // Check if port has 'open' method consistent with SerialPort or USBDevice
    // USBDevice has open(), SerialPort has open({baudRate})
    // A robust check:
    const isUSB = 'productId' in port && 'vendorId' in port && !('getInfo' in port);

    if (isUSB) {
        if (flashMethod === 'stlink') {
            return flashSTM32SWD(port as USBDevice, firmwareData, options);
        }
        return flashSTM32DFU(port as USBDevice, firmwareData, options);
    } else {
        if (flashMethod === 'ardupilot_passthrough') {
            if (!options.passthroughSerial) {
                throw new Error("Passthrough Serial port not specified for ArduPilot Passthrough");
            }
            
            const isEsp = chipset.startsWith('esp');
            const result = await initArduPilotPassthrough(port as SerialPort, options.passthroughSerial, isEsp, onLog);
            port = result.port;
            
            // For STM32, if we didn't force 115200, we might need to tell the flasher to use the detected baud
            if (!isEsp) {
                options.baud = result.baudRate;
                onLog?.(`STM32 Passthrough: Using FC baud rate ${options.baud}`);
            }
        } else if (flashMethod === 'inav_passthrough') {
             if (options.passthroughIdentifier === undefined) {
                 throw new Error("Target UART not specified for INAV Passthrough");
             }
             const svc = new InavPassthroughService(port as SerialPort, onLog);

             // Use detected baud rate for passthrough activation, default to 115200
             const activationBaud = options.activationBaud || 115200;
             onLog?.(`INAV Passthrough: Using activation baud ${activationBaud}`);

             // Connect at activation baud - INAV mirrors host baud to the bridged UART
             await svc.reconnect(activationBaud);

             // Send passthrough command and reboot (enterPassthrough closes port when done)
             await svc.enterPassthrough(options.passthroughIdentifier, activationBaud, true);

             // STM32 bootloader uses 115200 - INAV will mirror when we reopen at this baud
             options.baud = 115200;
        }
        return flashSTM32UART(port as SerialPort, firmwareData, options);
    }
  } else if (chipset.startsWith('esp')) {
     const isSerial = 'getInfo' in port;
     if (!isSerial) {
         throw new Error('ESP flashing requires a SerialPort');
     }
     
     if (options.targetType === 'txint') {
         onLog?.("Initializing EdgeTX Passthrough for internal module...");
         
         // Always disable DTR/RTS toggling for internal modules
         options.reset = 'no_reset';

         // Check for Wireless Bridge hardware or firmware
         const isBridge = !!((options.device && options.device.toLowerCase().includes('bridge')) || 
                          (options.filename && options.filename.toLowerCase().includes('bridge')));

         onLog?.("Internal Module: Checking baud rate settings...");
         
         if (isBridge) {
             onLog?.("Wireless Bridge detected: Forcing 115200 baud.");
             options.baud = 115200;
         } else {
             if (!options.baud) {
                 onLog?.("Standard Internal Module: Defaulting to 921600 baud.");
                 options.baud = 921600;
             }
         }
         
         await initEdgeTXPassthrough(port as SerialPort, options.baud, isBridge, onLog);
         await new Promise(r => setTimeout(r, 500));
     }

     // Handle ArduPilot Passthrough for ESP
     if (flashMethod === 'ardupilot_passthrough') {
        if (!options.passthroughSerial) {
            throw new Error("Passthrough Serial port not specified for ArduPilot Passthrough");
        }
        const result = await initArduPilotPassthrough(port as SerialPort, options.passthroughSerial, true, onLog);
        port = result.port;
        // ESP always forced to 115200 by initArduPilotPassthrough logic
     } else if (flashMethod === 'inav_passthrough') {
        if (options.passthroughIdentifier === undefined) {
            throw new Error("Target UART not specified for INAV Passthrough");
        }
        const svc = new InavPassthroughService(port as SerialPort, onLog);
        await svc.connect();
        await svc.enterPassthrough(options.passthroughIdentifier, 921600);
        options.baud = 921600;
     }

     return flashESP(port as SerialPort, firmwareData, options);
  } else {
    throw new Error(`Unsupported chipset: ${chipset}`);
  }
}

export async function initEdgeTXPassthrough(
    port: SerialPort,
    baudrate: number,
    isWirelessBridge: boolean = false,
    onLog?: (msg: string) => void
): Promise<void> {
    onLog?.("EdgeTX Passthrough: Connecting to radio...");
    
    // We must ensure the port is opened at 115200 for CLI commands
    // Web Serial might already have it open, so we need to be careful.
    // In our web app structure, the port is usually NOT yet opened when flash() is called.
    
    const wasOpen = !!port.readable;
    if (!wasOpen) {
        await port.open({ baudRate: 115200 });
    }

    const reader = port.readable!.getReader();
    const writer = port.writable!.getWriter();
    const decoder = new TextDecoder();
    const encoder = new TextEncoder();

    const executeCommand = async (cmd: string, expected?: string, timeout = 2000): Promise<string> => {
        onLog?.(`> ${cmd}`);
        await writer.write(encoder.encode(cmd + '\n'));
        
        let response = '';
        const startTime = Date.now();
        
        while (Date.now() - startTime < timeout) {
            try {
                const { value, done } = await Promise.race([
                    reader.read(),
                    new Promise<ReadableStreamReadResult<Uint8Array>>((_, reject) => setTimeout(() => reject(new Error("Timeout")), 500))
                ]);

                if (done) break;
                if (value) {
                    response += decoder.decode(value);
                    if (response.endsWith('\r\n> ')) break;
                }
            } catch (e) {
                 // Timeout or read error
            }
        }

        if (expected && !response.includes(expected)) {
            // Some commands might have different responses depending on EdgeTX version
            // For now, just log and continue if it's not a critical failure
            onLog?.(`Warning: Expected "${expected}" in response, but got: ${response.trim()}`);
        }
        return response;
    };

    try {
        await executeCommand('set pulses 0', 'pulses stop');
        
        // Logic from edgetxInitPassthru.py:
        // Skip initial bootpin assertion for wireless bridge
        if (!isWirelessBridge) {
            await executeCommand('set rfmod 0 bootpin 1', 'boot');
        }
        
        onLog?.("Power cycling RF module...");
        await executeCommand('set rfmod 0 power off');
        await new Promise(r => setTimeout(r, 500));
        await executeCommand('set rfmod 0 power on');
        await new Promise(r => setTimeout(r, 500));

        if (isWirelessBridge) {
            onLog?.("Waiting 7s for wireless bridge configuration...");
            await new Promise(r => setTimeout(r, 7000));
        }

        await executeCommand('set rfmod 0 bootpin 1', 'boot');
        await executeCommand('set rfmod 0 bootpin 0', 'boot');

        onLog?.(`Enabling serial passthrough at ${baudrate} baud...`);
        // Note: we don't wait for response here as the CLI effectively terminates
        await writer.write(encoder.encode(`serialpassthrough rfmod 0 ${baudrate}\n`));
        await new Promise(r => setTimeout(r, 500));
        
    } finally {
        reader.releaseLock();
        writer.releaseLock();
        // We close the port so that the subsequent flash step can re-open it at the target baud rate
        await port.close();
    }
}

const fetchBinary = async (path: string): Promise<string> => {
    const response = await fetch(path);
    if (!response.ok) throw new Error(`Failed to fetch ${path}`);
    const buffer = await response.arrayBuffer();
    // safe conversion: avoid TextDecoder('iso-8859-1') as it acts like windows-1252 
    // and corrupts bytes 0x80-0x9F. use optimized O(n) approach.
    const bytes = new Uint8Array(buffer);
    return Array.from(bytes, b => String.fromCharCode(b)).join('');
};

async function flashESP(
  port: SerialPort,
  firmwareData: ArrayBuffer,
  options: FlasherOptions
): Promise<void> {
  const sm = new FlasherStateMachine(options.onProgress, options.onLog);
  const { baud = 921600, erase, filename, reset, flashMethod, isLocalFile } = options;

  sm.transition('CONNECTING', "Connecting to ESP device...");
  
  // Ensure port is closed (so esptool can open it) 
  if (port.readable || port.writable) {
      sm.log("Port appears open, attempting to close...");
      try {
          await port.close(); 
          sm.log("Port closed in flashESP.");
      } catch (e) {
          sm.log(`Warning: Port closure in flashESP failed: ${e instanceof Error ? e.message : String(e)}`);
      }
      // Wait a moment for OS to release the port
      await new Promise(r => setTimeout(r, 500));
  }

  // give the browser extra time to fully release the port
  await new Promise(r => setTimeout(r, 500));

  // @ts-ignore: ESPLoader types are not perfect
  const transport = new Transport(port as any);

  // disable DTR/RTS for manual bootloader and passthrough modes
  if ((reset && (reset.includes('no dtr') || reset.includes('no_reset'))) || flashMethod === 'ardupilot_passthrough' || flashMethod === 'inav_passthrough') {
      transport.setDTR = async () => { /* no-op */ };
      transport.setRTS = async () => { /* no-op */ };
  }
  
  const esploader = new ESPLoader({
    transport: transport,
    baudrate: baud,
    terminal: {
        clean: () => {},
        writeLine: (data: string) => { 
            const trimmed = data.trim();
            if (trimmed.length > 0 && trimmed !== 'esptool.js' && !trimmed.startsWith('Serial port')) {
                sm.log(data); 
            }
        },
        write: (data: string) => { 
            const trimmed = data.trim();
            if (trimmed.length > 0 && trimmed !== 'esptool.js' && !trimmed.startsWith('Serial port')) {
                sm.log(data); 
            }
        },
    },
    romBaudrate: 115200,
  });

  try {
    let chipName: string;
    
    const resetMode = (flashMethod === 'ardupilot_passthrough' || flashMethod === 'inav_passthrough') 
        ? 'no_reset' as Before 
        : (reset as Before || 'default_reset');
    

    chipName = await esploader.main(resetMode);
    
    sm.log(`Detected chip: ${chipName}`);

    if (erase === 'full_erase') {
        sm.transition('ERASING', "Performing full erase...");
        await esploader.eraseFlash();
    }

    sm.log("Preparing firmware files...");
    // safe conversion: optimized O(n) approach to preserve 0x80-0x9F bytes
    const firmwareBytes = new Uint8Array(firmwareData);
    const firmwareStr = Array.from(firmwareBytes, b => String.fromCharCode(b)).join('');
    
    // Default to single file at 0x0
    let fileArray = [
        { data: firmwareStr, address: 0x0 }
    ];
    let flashSize = '4MB';
    let flashMode = 'dio';
    let flashFreq = '40m';

    const cleanChip = chipName.replace(/-/g, '').toLowerCase(); // e.g. esp32s3, esp32c3, esp32

    if (cleanChip.includes('esp32')) {
        let bootloaderPath = '';
        let partitionsPath = '';
        let bootAppPath = '';
        let bootloaderOffset = 0x1000;
        const firmwareOffset = 0x10000;

        if (cleanChip.includes('esp32c3')) {
            bootloaderPath = resolveAssetPath('/assets/esp32c3/bootloader.bin');
            bootAppPath = resolveAssetPath('/assets/esp32c3/boot_app0.bin');
            bootloaderOffset = 0x0000;
            flashSize = '4MB';

            // Use no-OTA partition for ESP32C3 bridges (both external and internal Tx)
            // Receivers continue to use the standard partitions.bin
            const isBridge = options.isWirelessBridge ||
                             (options.filename && options.filename.toLowerCase().includes('bridge'));

            if (isBridge) {
                partitionsPath = resolveAssetPath('/assets/esp32c3/partitions_noota.bin');
                sm.log("Using no-OTA partition table for ESP32C3 bridge");
            } else {
                partitionsPath = resolveAssetPath('/assets/esp32c3/partitions.bin');
            }
        } else if (cleanChip.includes('esp32s3')) {
            bootloaderPath = resolveAssetPath('/assets/esp32s3/bootloader.bin');
            partitionsPath = resolveAssetPath('/assets/esp32s3/partitions.bin');
            bootAppPath = resolveAssetPath('/assets/esp32s3/boot_app0.bin');
            bootloaderOffset = 0x0000;
            flashSize = '8MB';
        } else {
            // Standard ESP32
            partitionsPath = resolveAssetPath('/assets/esp32/partitions.bin');
            bootAppPath = resolveAssetPath('/assets/esp32/boot_app0.bin');
            bootloaderOffset = 0x1000;
            flashSize = '4MB';
            
            // local file mode always uses 80qio; github downloads use version-based selection
            let bootloaderFile = 'bootloader_80qio.bin';
            if (!isLocalFile && filename) {
                const match = filename.match(/v(\d+)\.(\d+)\.(\d+)/);
                if (match) {
                    const [_, major, minor, patch] = match.map(Number);
                    if (major < 1 || (major === 1 && minor < 3) || (major === 1 && minor === 3 && patch < 7)) {
                        bootloaderFile = 'bootloader_40dio.bin';
                    }
                }
            }
            bootloaderPath = resolveAssetPath(`/assets/esp32/${bootloaderFile}`);
        }

        sm.log(`Downloading auxiliary files for ${cleanChip}...`);
        const bootloader = await fetchBinary(bootloaderPath);
        const partitions = await fetchBinary(partitionsPath);
        const bootApp = await fetchBinary(bootAppPath);

        fileArray = [
            { data: bootloader, address: bootloaderOffset },
            { data: partitions, address: 0x8000 },
            { data: bootApp, address: 0xe000 },
            { data: firmwareStr, address: firmwareOffset }
        ];
    } else if (cleanChip.includes('esp8266') || cleanChip.includes('esp8285')) {
         fileArray = [{ data: firmwareStr, address: 0x0 }];
    }

    sm.transition('WRITING', "Writing flash...");
    const flashOptions = {
        fileArray,
        flashSize,
        flashMode,
        flashFreq,
        eraseAll: false,
        compress: true,
    };
    
    sm.log(`Flash Params: Mode=${flashOptions.flashMode}, Freq=${flashOptions.flashFreq}, Size=${flashOptions.flashSize}, Compress=${flashOptions.compress}`);
    for (const file of fileArray) {
        sm.log(`Writing ${file.data.length} bytes to 0x${file.address.toString(16)}`);
    }

    await esploader.writeFlash({
        ...flashOptions,
        calculateMD5Hash: (_data: any) => "",
        reportProgress: (_fileIndex: number, written: number, total: number) => {
            const progress = Math.round((written / total) * 100);
            sm.updateProgress(progress);
        }
    } as any);

    sm.transition('RESETTING', "Flash complete! Resetting device...");
    
    // Manual Reset Sequence (resets the ESP)
    await transport.setDTR(false);
    await transport.setRTS(true);
    await new Promise(r => setTimeout(r, 500));
    await transport.setRTS(false);
    
    await transport.disconnect();
    
    // for external tx wireless bridge: reset the main MCU via DTR/RTS
    // DTR/RTS connects to USB-UART which is wired to main MCU reset
    if (options.isWirelessBridge && options.targetType === 'tx') {
      sm.log("Resetting main MCU after wireless bridge flash...");
      await new Promise(r => setTimeout(r, 500));
      
      // re-open port to toggle DTR/RTS for main MCU reset
      try {
        await port.open({ baudRate: 115200 });
        const writer = port.writable!.getWriter();
        
        // toggle DTR to trigger main MCU reset
        await port.setSignals({ dataTerminalReady: false });
        await new Promise(r => setTimeout(r, 500));
        await port.setSignals({ dataTerminalReady: true });
        await new Promise(r => setTimeout(r, 500));
        await port.setSignals({ dataTerminalReady: false });
        
        writer.releaseLock();
        await port.close();
        sm.log("Main MCU reset complete.");
      } catch (e) {
        sm.log(`Warning: Main MCU reset failed: ${e instanceof Error ? e.message : String(e)}`);
      }
    }
    
    sm.transition('DONE');
  } catch (err) {
    sm.transition('ERROR', `Error during ESP flash: ${err instanceof Error ? err.message : String(err)}`);
    throw err;
  }
}

async function flashSTM32SWD(
  device: USBDevice,
  firmwareData: ArrayBuffer,
  options: FlasherOptions
): Promise<void> {
  const sm = new FlasherStateMachine(options.onProgress, options.onLog);
  sm.transition('CONNECTING', "Connecting to ST-Link...");

  let binaryData = new Uint8Array(firmwareData);
  let startAddress = FLASH_BASE; // Default to 0x08000000

  // HEX Processing
  if (options.filename?.toLowerCase().endsWith('.hex')) {
      sm.log("Converting Intel HEX to binary...");
      const decoder = new TextDecoder('utf-8');
      const hexString = decoder.decode(firmwareData);
      
      try {
          const blocks = parseHex(hexString);
          blocks.sort((a, b) => a.address - b.address);
          
          if (blocks.length > 0) {
              startAddress = blocks[0].address;
              const lastBlock = blocks[blocks.length - 1];
              const endAddr = lastBlock.address + lastBlock.data.length;
              const totalLen = endAddr - startAddress;

              // Safety check: Don't allocate massive buffers if there's a huge gap (e.g. > 2MB)
              if (totalLen > 2 * 1024 * 1024) {
                   throw new Error("HEX file content spans too large a memory range. Please use a contiguous firmware file.");
              }

              const combined = new Uint8Array(totalLen);
              combined.fill(0xFF); // Fill with erased state (0xFF)

              for (const block of blocks) {
                  const offset = block.address - startAddress;
                  combined.set(block.data, offset);
              }

              binaryData = combined;
              sm.log(`HEX converted: ${binaryData.byteLength} bytes at 0x${startAddress.toString(16)} (padded with 0xFF)`);
          } else {
              throw new Error("HEX file is empty");
          }
      } catch (e) {
          throw new Error(`Failed to parse HEX file: ${e instanceof Error ? e.message : String(e)}`);
      }
  }

  // ST-Link Operation
  const stlink = new StlinkDevice(device, (level, msg) => {
      // Map STLink logs to state machine logs
      if (level === 'error') sm.log(`Error: ${msg}`);
      else if (level === 'warn') sm.log(`Warning: ${msg}`);
      else sm.log(msg);
  });

  try {
      await stlink.connect();
      sm.log("ST-Link connected.");
      
      const chip = stlink.chipInfo;
      if (chip) {
          sm.log(`Detected Chip: ${chip.devType} (Flash: ${stlink.flashSize/1024}KB, Page: ${chip.flashPageSize}B)`);
      } else {
          sm.log(`Warning: Unknown Chip ID 0x${stlink.chipId.toString(16)}`);
      }

      sm.transition('WRITING', "Starting flash operation...");
      
      const flashOps = new FlashOperations(stlink, (level, msg) => {
           if (level === 'error') sm.log(`Flash Error: ${msg}`);
           else sm.log(msg); // Flash ops logs are verbose, maybe filter?
      });

      // flashFirmware handles Unlock -> Erase -> Program -> Verify -> Reset
      await flashOps.flashFirmware(
          startAddress, 
          binaryData, 
          chip ? chip.flashPageSize : 1024, // Default to 1KB if unknown
          (percent, status) => {
              sm.updateProgress(percent);
              // Simple mapping of progress to state
              if (percent < 30 && sm['state'] !== 'ERASING') sm.transition('ERASING', status);
              else if (percent >= 30 && percent < 70 && sm['state'] !== 'WRITING') sm.transition('WRITING', status);
              else if (percent >= 70 && sm['state'] !== 'VERIFYING') sm.transition('VERIFYING', status);
          }
      );

      sm.transition('DONE', "ST-Link Flash Complete! Device reset.");

  } catch (err) {
      sm.transition('ERROR', `Error during ST-Link flash: ${err instanceof Error ? err.message : String(err)}`);
      throw err;
  } finally {
      try {
          await stlink.disconnect();
      } catch (e) { /* ignore disconnect errors */ }
  }
}

async function flashSTM32DFU(
  device: USBDevice,
  firmwareData: ArrayBuffer,
  options: FlasherOptions
): Promise<void> {
  const sm = new FlasherStateMachine(options.onProgress, options.onLog);
  sm.transition('CONNECTING', "Starting STM32 DFU flash...");
  
  let binaryData = firmwareData;
  if (options.filename?.toLowerCase().endsWith('.hex')) {
      sm.log("Converting Intel HEX to binary...");
      const decoder = new TextDecoder('utf-8');
      const hexString = decoder.decode(firmwareData);
      
      try {
          const blocks = parseHex(hexString);
          
          // For DFU, we typically expect a single contiguous block or we need to concatenate.
          // The previous implementation effectively concatenated all data bytes.
          // We now handle gaps by creating a contiguous buffer padded with 0xFF.
          
          blocks.sort((a, b) => a.address - b.address);
          
          if (blocks.length > 0) {
              const startAddr = blocks[0].address;
              const lastBlock = blocks[blocks.length - 1];
              const endAddr = lastBlock.address + lastBlock.data.length;
              const totalLen = endAddr - startAddr;

              // Safety check: Don't allocate massive buffers if there's a huge gap (e.g. > 2MB)
              if (totalLen > 2 * 1024 * 1024) {
                   throw new Error("HEX file content spans too large a memory range for DFU. Please use a contiguous firmware file.");
              }

              const combined = new Uint8Array(totalLen);
              combined.fill(0xFF); // Fill with erased state

              for (const block of blocks) {
                  const offset = block.address - startAddr;
                  combined.set(block.data, offset);
              }

              binaryData = combined.buffer;
              sm.log(`HEX converted: ${binaryData.byteLength} bytes (padded with 0xFF for gaps)`);
          } else {
              throw new Error("HEX file is empty");
          }
      } catch (e) {
          throw new Error(`Failed to parse HEX file: ${e instanceof Error ? e.message : String(e)}`);
      }
  }
  
  try {
    // Correct DFU usage based on webdfu implementation and mlrs.xyz reference
    
    // 1. Find valid DFU interfaces
    const interfaces = DFU.findDeviceDfuInterfaces(device);
    if (!interfaces || interfaces.length === 0) {
       throw new Error("No DFU interfaces found on device. Ensure it is in DFU mode.");
    }
    
    // 1b. Fix interface names if they are null (mimics fixInterfaceNames from reference)
    if (interfaces.some((intf: any) => intf.name === null)) {
        sm.log("Reading interface names from device descriptors...");
        const tempDevice = new DFU.Device(device, interfaces[0]);
        await tempDevice.device_.open();
        await tempDevice.device_.selectConfiguration(1);
        const mapping = await tempDevice.readInterfaceNames();
        await tempDevice.close();
        
        for (const intf of interfaces) {
            if (intf.name === null) {
                const configIndex = intf.configuration.configurationValue;
                const intfNumber = intf["interface"].interfaceNumber;
                const alt = intf.alternate.alternateSetting;
                if (mapping[configIndex] && mapping[configIndex][intfNumber] && mapping[configIndex][intfNumber][alt]) {
                    intf.name = mapping[configIndex][intfNumber][alt];
                }
            }
        }
    }
    
    // 2. Select the first interface (standard practice), preferring Flash interface if multiple exist
    let settings = interfaces[0];
    if (interfaces.length > 1) {
        const flashInterface = interfaces.find((a: any) => a.name && a.name.indexOf('Flash') !== -1);
        if (flashInterface) {
            settings = flashInterface;
        }
    }
    sm.log(`Found DFU interface: ${settings.name || 'Unnamed'} (Alt ${settings.alternate.alternateSetting})`);

    // 3. Create initial DFU device instance to read descriptors
    let dfu: InstanceType<typeof DFU.Device> | InstanceType<typeof DFUse.Device> = new DFU.Device(device, settings);

    // 4. Hook up logging helper
    let lastLoggedProgress = 0;
    const setupLogging = (dev: any) => {
        dev.logDebug = (msg: string) => console.debug(msg);
        dev.logInfo = (msg: string) => sm.log(msg);
        dev.logWarning = (msg: string) => sm.log(`Warning: ${msg}`);
        dev.logError = (msg: string) => sm.log(`Error: ${msg}`);
        dev.logProgress = (done: number, total: number) => {
            if (total) {
                const progress = Math.round((done / total) * 100);
                sm.updateProgress(progress);
                
                // Reset tracker if a new operation starts (progress drops)
                if (progress < lastLoggedProgress) {
                    lastLoggedProgress = 0;
                    // Try to infer state from progress movement (heuristic)
                    // Usually this means we started writing after erase, or verifying
                    if (sm['state'] === 'ERASING') sm.transition('WRITING');
                }

                // Log every 10% (when the 10s digit changes) or at 100%
                if (progress === 100 || Math.floor(progress / 10) > Math.floor(lastLoggedProgress / 10)) {
                    sm.log(`Progress: ${progress}%`);
                    lastLoggedProgress = progress;
                }
            } else {
                sm.updateProgress(0, `Flash: ${done} bytes`);
            }
        };
    };
    setupLogging(dfu);

    sm.log("Opening DFU device...");
    await dfu.open();
    
    // 5. Determine DFU version and Manifestation Tolerance from Descriptor
    let manifestationTolerant = true; // Default
    let dfuVersion = 0;
    let transferSize = 2048; // Default for STM32
    try {
        const data = await dfu.readConfigurationDescriptor(0);
        const configDesc = DFU.parseConfigurationDescriptor(data);
        
        let funcDesc = null;
        let configValue = dfu.settings.configuration.configurationValue;
        if (configDesc.bConfigurationValue === configValue) {
            for (let desc of configDesc.descriptors) {
                if (desc.bDescriptorType === 0x21 && desc.hasOwnProperty("bcdDFUVersion")) {
                    funcDesc = desc;
                    break;
                }
            }
        }
        
        if (funcDesc) {
            if (funcDesc.bmAttributes !== undefined) {
                 const canDnload = (funcDesc.bmAttributes & 0x01) !== 0;
                 if (canDnload) {
                     manifestationTolerant = (funcDesc.bmAttributes & 0x04) !== 0;
                 }
            }
            if (funcDesc.wTransferSize !== undefined) {
                transferSize = funcDesc.wTransferSize;
            }
            if (funcDesc.bcdDFUVersion !== undefined) {
                dfuVersion = funcDesc.bcdDFUVersion;
            }
            sm.log(`DFU Descriptor: Version=0x${dfuVersion.toString(16)}, ManifestationTolerant=${manifestationTolerant}, TransferSize=${transferSize}`);
        }
        
    } catch (error) {
         sm.log(`Warning: Failed to read DFU descriptor. Error: ${error}`);
    }

    // 6. If DFU version is 0x011a (DFuSe) and in DFU mode, switch to DFUse.Device
    if (dfuVersion === 0x011a && settings.alternate.interfaceProtocol === 0x02) {
        sm.log("DFuSe protocol detected. Switching to DFUse device...");
        await dfu.close();
        dfu = new DFUse.Device(device, settings);
        setupLogging(dfu);
        await dfu.open();
        
        // Check memory info and set start address
        const dfuseDevice = dfu as InstanceType<typeof DFUse.Device>;
        if (dfuseDevice.memoryInfo) {
            sm.log(`Memory: ${dfuseDevice.memoryInfo.name}`);
            let totalSize = 0;
            for (let segment of dfuseDevice.memoryInfo.segments) {
                totalSize += segment.end - segment.start;
            }
            sm.log(`Total writable: ${(totalSize / 1024).toFixed(1)} KB`);
            
            // Set start address to first writable segment to avoid "inferred" warning
            const firstWritable = dfuseDevice.memoryInfo.segments.find(s => s.writable);
            if (firstWritable) {
                dfuseDevice.startAddress = firstWritable.start;
                sm.log(`Start address: 0x${firstWritable.start.toString(16)}`);
            }
        } else {
            sm.log("Warning: No memory info parsed from interface name.");
        }
    }

    sm.transition('ERASING', "DFU connected. Beginning firmware download...");
    
    // do_download handles the whole process including manifestation
    // It does Erase -> Write -> Verify (if implemented)
    // We don't have fine-grained control over "Erase" vs "Write" in do_download 
    // without implementing it manually, but webdfu's logProgress will fire.
    try {
        await dfu.do_download(transferSize, binaryData, manifestationTolerant);
    } catch (error: any) {
        // webdfu throws an error if reset fails because the device disconnected.
        // This is actually success (device rebooted).
        if (error.message && (
            error.message.includes("Error during reset for manifestation") || 
            error.message.includes("The device was disconnected") ||
            error.message.includes("Device unavailable")
        )) {
            sm.log("Device reset successfully (connection lost as expected).");
        } else {
            throw error;
        }
    }

    sm.transition('DONE', "STM32 DFU Flash complete!");
    
    // Attempt closure if still connected
    try {
        await dfu.close(); 
    } catch (e) { /* ignore */ }
    
  } catch (err) {
    sm.transition('ERROR', `Error during STM32 DFU flash: ${err instanceof Error ? err.message : String(err)}`);
    throw err;
  }
}

async function flashSTM32UART(
  port: SerialPort,
  firmwareData: ArrayBuffer,
  options: FlasherOptions
): Promise<void> {
  const sm = new FlasherStateMachine(options.onProgress, options.onLog);
  sm.transition('CONNECTING', "Starting STM32 UART flash...");

  // Ensure port is closed (so stm32 flasher can open it with correct parity)
  // Rapid state changes and parity switches can cause browser/driver crashes.
  if (port.readable || port.writable) {
      sm.log("Port appears open, attempting to close to stabilize...");
      try {
          await port.close();
          sm.log("Port closed for stabilization.");
      } catch (e) {
          sm.log(`Warning: Port closure during stabilization failed: ${e instanceof Error ? e.message : String(e)}`);
      }
      // Give the OS/browser extra time to fully release the port and settle
      await new Promise(r => setTimeout(r, 1000));
  }

  let memoryBlocks: { address: number, data: Uint8Array }[] = [];

  if (options.filename?.toLowerCase().endsWith('.hex')) {
      sm.log("Converting Intel HEX to binary blocks...");
      const decoder = new TextDecoder();
      const hexText = decoder.decode(firmwareData);
      
      try {
          memoryBlocks = parseHex(hexText);
          let totalBytes = memoryBlocks.reduce((acc, b) => acc + b.data.length, 0);
          sm.log(`HEX converted: ${totalBytes} bytes in ${memoryBlocks.length} blocks`);
      } catch (e) {
          throw new Error(`Failed to parse HEX file: ${e instanceof Error ? e.message : String(e)}`);
      }
      
  } else {
      // Binary file - assume 0x08000000 start for STM32
      memoryBlocks.push({ address: 0x08000000, data: new Uint8Array(firmwareData) });
  }
  
  const protocol = new Stm32UartProtocol(port, (msg) => sm.log(msg));
  try {
    await protocol.connect();
    sm.log("Connected to STM32 bootloader.");

    sm.transition('SYNCING');
    const info = await protocol.get();
    sm.log(`Bootloader version: ${info.version.toString(16)}`);

    const chipId = await protocol.getId();
    sm.log(`Chip ID: 0x${chipId.toString(16)}`);

    // determine page size and erase necessary pages
    const pageSize = getPageSize(chipId);
    if (!isKnownChip(chipId)) {
        sm.log(`Warning: Unknown Chip ID 0x${chipId.toString(16)}. Assuming 2KB page size.`);
    } else {
        sm.log(`Detected Page Size: ${pageSize} bytes`);
    }

    sm.transition('ERASING', "Calculating pages to erase...");
    
    // calculate unique pages
    const pagesToErase = new Set<number>();

    for (const block of memoryBlocks) {
        let addr = block.address;
        const end = block.address + block.data.length;
        
        // only erase if in flash range (standard STM32 flash starts at 0x08000000)
        if (addr >= FLASH_BASE && addr < FLASH_BASE + MAX_FLASH_SIZE) {
             while (addr < end) {
                 const pageIndex = Math.floor((addr - FLASH_BASE) / pageSize);
                 pagesToErase.add(pageIndex);
                 // Jump to the exact start of the next page
                 addr = FLASH_BASE + (pageIndex + 1) * pageSize;
             }
        }
    }
    
    const sortedPages = Array.from(pagesToErase).sort((a, b) => a - b);
    if (sortedPages.length === 0) {
        sm.log("Warning: No flash pages found to erase (maybe writing to RAM?). Skipping erase.");
    } else {
        sm.log(`Erasing ${sortedPages.length} pages: ${sortedPages.join(', ')}...`);
        await protocol.erasePages(sortedPages);
    }

    sm.transition('WRITING');
    
    let totalSize = memoryBlocks.reduce((acc, b) => acc + b.data.length, 0);
    let totalWritten = 0;
    let lastLogBytes = 0;

    for (const block of memoryBlocks) {
        sm.log(`Writing block at 0x${block.address.toString(16)} (${block.data.length} bytes)...`);
        
        const data = block.data;
        const len = data.length;
        let written = 0;
        const chunkSize = 256;

        while (written < len) {
            const remaining = len - written;
            const currentChunkSize = Math.min(remaining, chunkSize);
            const chunk = data.slice(written, written + currentChunkSize);
            
            await protocol.writeMemory(block.address + written, chunk);
            
            written += currentChunkSize;
            totalWritten += currentChunkSize;
            
            const progress = Math.round((totalWritten / totalSize) * 100);
            sm.updateProgress(progress);

            // Log progress every 10KB
            const currentKb = Math.floor(totalWritten / 1024);
            const lastKb = Math.floor(lastLogBytes / 1024);
            if ((currentKb === 1 && lastKb === 0) || (currentKb >= 10 && Math.floor(currentKb / 10) > Math.floor(lastKb / 10))) {
                sm.log(`Written ${currentKb} KB...`);
                lastLogBytes = totalWritten;
            }
        }
    }

    sm.transition('VERIFYING', "Verifying flashed data...");
    totalWritten = 0; // Reset counter for verification phase
    lastLogBytes = 0;

    for (const block of memoryBlocks) {
        sm.log(`Verifying block at 0x${block.address.toString(16)} (${block.data.length} bytes)...`);
        
        const data = block.data;
        const len = data.length;
        let verified = 0;
        const chunkSize = 256;

        while (verified < len) {
            const remaining = len - verified;
            const currentChunkSize = Math.min(remaining, chunkSize);
            
            const readBack = await protocol.readMemory(block.address + verified, currentChunkSize);
            
            // Compare
            for (let i = 0; i < currentChunkSize; i++) {
                if (readBack[i] !== data[verified + i]) {
                    throw new Error(`Verification failed at 0x${(block.address + verified + i).toString(16)}: expected 0x${data[verified + i].toString(16)}, got 0x${readBack[i].toString(16)}`);
                }
            }
            
            verified += currentChunkSize;
            totalWritten += currentChunkSize;
            
            const progress = Math.round((totalWritten / totalSize) * 100);
            sm.updateProgress(progress);

            const currentKb = Math.floor(totalWritten / 1024);
            const lastKb = Math.floor(lastLogBytes / 1024);
            if ((currentKb === 1 && lastKb === 0) || (currentKb >= 10 && Math.floor(currentKb / 10) > Math.floor(lastKb / 10))) {
                sm.log(`Verified ${currentKb} KB...`);
                lastLogBytes = totalWritten;
            }
        }
    }

    sm.transition('DONE', "STM32 UART Flash complete!");
  } catch (err) {
    sm.transition('ERROR', `Error during STM32 UART flash: ${err instanceof Error ? err.message : String(err)}`);
    if (err instanceof Error && (err.message.includes("no ACK") || err.message.includes("timeout"))) {
        sm.log("Hint: Check your connections and ensure the device is in bootloader mode.");
    }
    throw err;
  } finally {
    await protocol.disconnect();
  }
}
