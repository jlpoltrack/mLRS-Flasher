import { ESPLoader, Transport } from 'esptool-js';
import { DFU, DFUse } from 'webdfu';

import { initApPassthrough } from './apPassthru';
import { FlasherStateMachine } from './flasherStateMachine';


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
    if (port instanceof USBDevice) {
        return flashSTM32DFU(port, firmwareData, options);
    } else {
        if (flashMethod === 'appassthru') {
            if (!options.passthroughSerial) {
                throw new Error("Passthrough Serial port not specified for AP Passthrough");
            }
            
            const isEsp = chipset.startsWith('esp');
            const result = await initApPassthrough(port as SerialPort, options.passthroughSerial, isEsp, onLog);
            port = result.port;
            
            // For STM32, if we didn't force 115200, we might need to tell the flasher to use the detected baud
            if (!isEsp) {
                options.baud = result.baudRate;
                onLog?.(`STM32 Passthrough: Using FC baud rate ${options.baud}`);
            }
        }
        return flashSTM32UART(port as SerialPort, firmwareData, options);
    }
  } else if (chipset.startsWith('esp')) {
     if (port.constructor.name !== 'SerialPort') {
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

     // Handle AP Passthru for ESP
     if (flashMethod === 'appassthru') {
        if (!options.passthroughSerial) {
            throw new Error("Passthrough Serial port not specified for AP Passthrough");
        }
        const result = await initApPassthrough(port as SerialPort, options.passthroughSerial, true, onLog);
        port = result.port;
        // ESP always forced to 115200 by initApPassthrough logic
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
            const { value, done } = await Promise.race([
                reader.read(),
                new Promise<any>((_, reject) => setTimeout(() => reject(new Error("Timeout")), 500))
            ]).catch(() => ({ value: null, done: false }));

            if (done) break;
            if (value) {
                response += decoder.decode(value);
                if (response.endsWith('\r\n> ')) break;
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
        await new Promise(r => setTimeout(r, 1000));
        await executeCommand('set rfmod 0 power on');
        await new Promise(r => setTimeout(r, 1000));

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
    // SAFE CONVERSION: Avoid TextDecoder('iso-8859-1') as it acts like windows-1252 
    // and corrupts bytes 0x80-0x9F.
    let binary = "";
    const bytes = new Uint8Array(buffer);
    const len = bytes.byteLength;
    for (let i = 0; i < len; i++) {
        binary += String.fromCharCode(bytes[i]);
    }
    return binary;
};

async function flashESP(
  port: SerialPort,
  firmwareData: ArrayBuffer,
  options: FlasherOptions
): Promise<void> {
  const sm = new FlasherStateMachine(options.onProgress, options.onLog);
  const { baud = 921600, erase, filename, reset, flashMethod } = options;

  sm.transition('CONNECTING', "Connecting to ESP device...");
  
  // Ensure port is closed (so esptool can open it)
  if (port.readable || port.writable) {
      try {
          await port.close(); 
      } catch (e: any) {
          sm.log(`Warning: Port closure check: ${e.message}`);
      }
  }

  const transport = new Transport(port);

  // FIX: Provide mechanism to disable DTR/RTS for manual bootloader devices
  if ((reset && (reset.includes('no dtr') || reset.includes('no_reset'))) || flashMethod === 'appassthru') {
      sm.log("Mode: Manual Bootloader / Passthru (No DTR/RTS toggle)");
      transport.setDTR = async () => { /* no-op */ };
      transport.setRTS = async () => { /* no-op */ };
  }
  
  const esploader = new ESPLoader({
    transport: transport,
    baudrate: baud,
    terminal: {
        clean: () => {},
        writeLine: (data: string) => sm.log(data),
        write: (data: string) => sm.log(data),
    },
    romBaudrate: 115200,
  });

  try {
    const chipName = await esploader.main();
    sm.log(`Detected chip: ${chipName}`);

    if (erase === 'full_erase') {
        sm.transition('ERASING', "Performing full erase...");
        await esploader.eraseFlash();
    }

    sm.log("Preparing firmware files...");
    // SAFE CONVERSION: Manual loop to preserve 0x80-0x9F
    let firmwareStr = "";
    const firmwareBytes = new Uint8Array(firmwareData);
    const fwLen = firmwareBytes.byteLength;
    for (let i = 0; i < fwLen; i++) {
        firmwareStr += String.fromCharCode(firmwareBytes[i]);
    }
    
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
            partitionsPath = resolveAssetPath('/assets/esp32c3/partitions.bin');
            bootAppPath = resolveAssetPath('/assets/esp32c3/boot_app0.bin');
            bootloaderOffset = 0x0000;
            flashSize = '4MB';
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
            
            // Determine bootloader 40dio vs 80qio
            let bootloaderFile = 'bootloader_40dio.bin';
            if (filename) {
                const match = filename.match(/v(\d+)\.(\d+)\.(\d+)/);
                if (match) {
                    const [_, major, minor, patch] = match.map(Number);
                    if (major > 1 || (major === 1 && minor > 3) || (major === 1 && minor === 3 && patch >= 7)) {
                        bootloaderFile = 'bootloader_80qio.bin';
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
    
    // Manual Reset Sequence
    await transport.setDTR(false);
    await transport.setRTS(true);
    await new Promise(r => setTimeout(r, 100));
    await transport.setRTS(false);
    
    await transport.disconnect();
    
    sm.transition('DONE');
  } catch (err: any) {
    sm.transition('ERROR', `Error during ESP flash: ${err.message}`);
    throw err;
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
          // We will mimic that behavior by sorting blocks and joining them.
          
          blocks.sort((a, b) => a.address - b.address);
          
          let totalLen = blocks.reduce((acc, b) => acc + b.data.length, 0);
          let combined = new Uint8Array(totalLen);
          let offset = 0;
          
          for (const block of blocks) {
             combined.set(block.data, offset);
             offset += block.data.length;
          }

          binaryData = combined.buffer;
          sm.log(`HEX converted: ${binaryData.byteLength} bytes from ${blocks.length} block(s)`);
      } catch (e: any) {
          throw new Error(`Failed to parse HEX file: ${e.message}`);
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
    
  } catch (err: any) {
    sm.transition('ERROR', `Error during STM32 DFU flash: ${err.message}`);
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

  let memoryBlocks: { address: number, data: Uint8Array }[] = [];

  if (options.filename?.toLowerCase().endsWith('.hex')) {
      sm.log("Converting Intel HEX to binary blocks...");
      const decoder = new TextDecoder();
      const hexText = decoder.decode(firmwareData);
      
      try {
          memoryBlocks = parseHex(hexText);
          let totalBytes = memoryBlocks.reduce((acc, b) => acc + b.data.length, 0);
          sm.log(`HEX converted: ${totalBytes} bytes in ${memoryBlocks.length} blocks`);
      } catch (e: any) {
          throw new Error(`Failed to parse HEX file: ${e.message}`);
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

    // Determine page size and erase necessary pages
    const CHIP_PAGE_SIZES: Record<number, number> = {
        0x410: 1024,  // STM32F1 Medium Density
        0x414: 2048,  // STM32F1 High Density
        0x415: 2048,  // STM32L433/L443
        0x435: 2048,  // STM32G431/G441 (Category 2)
        0x462: 2048,  // STM32L45x/46x
        0x413: 2048,  // STM32F4
        0x419: 2048,  // STM32F4
        0x497: 2048,  // STM32WLE5 (LoRa SOC)
    };

    const pageSize = CHIP_PAGE_SIZES[chipId] || 2048; // Default to 2KB if unknown
    if (!CHIP_PAGE_SIZES[chipId]) {
        sm.log(`Warning: Unknown Chip ID 0x${chipId.toString(16)}. Assuming 2KB page size.`);
    } else {
        sm.log(`Detected Page Size: ${pageSize} bytes`);
    }

    sm.transition('ERASING', "Calculating pages to erase...");
    
    // Calculate unique pages
    const pagesToErase = new Set<number>();
    // Flash base address is usually 0x08000000
    const FLASH_BASE = 0x08000000;

    for (const block of memoryBlocks) {
        let addr = block.address;
        const end = block.address + block.data.length;
        
        // Only erase if in Flash range (standard STM32 flash starts at 0x08000000)
        if (addr >= FLASH_BASE && addr < FLASH_BASE + 0x200000) { // Check up to 2MB
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
            if (totalWritten - lastLogBytes >= 10240) {
                sm.log(`Written ${Math.floor(totalWritten / 1024)} KB...`);
                lastLogBytes = totalWritten;
            }
        }
    }

    sm.transition('DONE', "STM32 UART Flash complete!");
  } catch (err: any) {
    sm.transition('ERROR', `Error during STM32 UART flash: ${err.message}`);
    if (err.message.includes("no ACK") || err.message.includes("timeout")) {
        sm.log("Hint: Check your connections and ensure the device is in bootloader mode.");
    }
    throw err;
  } finally {
    await protocol.disconnect();
  }
}

class Stm32UartProtocol {
    private reader: ReadableStreamDefaultReader<Uint8Array> | null = null;
    private writer: WritableStreamDefaultWriter<Uint8Array> | null = null;
    private port: SerialPort;
    private onLog?: (msg: string) => void;
    private commands: number[] = [];
    private rxBuffer: number[] = [];
    private readLoopActive = false;


    constructor(port: SerialPort, onLog?: (msg: string) => void) {
        this.port = port;
        this.onLog = onLog;
    }

    async connect() {
        // Explicitly set 8E1 and signals to match stm-serial-flasher reference state
        await (this.port as any).open({ baudRate: 115200, parity: 'even', stopBits: 1 });
        
        this.reader = this.port.readable!.getReader();
        this.writer = this.port.writable!.getWriter();

        this.startReadLoop();

        this.onLog?.("Flushing serial buffer...");
        this.flush();

        // Wait a moment for bootloader to be ready (prevents initial timeout)
        await new Promise(r => setTimeout(r, 1000));

        // Retry sync a few times
        for (let attempt = 1; attempt <= 3; attempt++) {
            this.onLog?.(`[TX] Sync (0x7F) - Attempt ${attempt}...`);
            try {
                await this.write(new Uint8Array([0x7F]));
                const resp = await this.read(1, 1500); // 1.5s timeout
                
                if (resp[0] === 0x79) {
                    this.onLog?.("[RX] Sync ACK (0x79) - OK.");
                    return;
                } else if (resp[0] === 0x1F) {
                    this.onLog?.("[RX] Sync NACK (0x1F) - Already Synced.");
                    return;
                } else {
                    this.onLog?.(`[RX] Unknown 0x${resp[0].toString(16)} (trying again)`);
                }
            } catch (e: any) {
                this.onLog?.(`Sync attempt ${attempt} failed: ${e.message}`);
            }
            
            await new Promise(r => setTimeout(r, 200));
        }
        
        throw new Error("Failed to sync with bootloader after 3 attempts. Ensure device is in bootloader mode.");
    }

    async disconnect() {
        this.readLoopActive = false;
        if (this.reader) {
            try { await this.reader.cancel(); } catch(e) {}
            this.reader.releaseLock();
            this.reader = null;
        }
        if (this.writer) {
            this.writer.releaseLock();
            this.writer = null;
        }
        try { await this.port.close(); } catch(e) {}
    }

    private startReadLoop() {
        if (this.readLoopActive) return;
        this.readLoopActive = true;
        (async () => {
            try {
                while (this.readLoopActive) {
                    const { value, done } = await this.reader!.read();
                    if (done) break;
                    if (value) {
                        const arr = Array.from(value);
                        this.rxBuffer.push(...arr);
                    }
                }
            } catch (e) {
                // Ignore errors during close
            } finally {
                this.readLoopActive = false;
            }
        })();
    }

    private flush() {
        this.rxBuffer = [];
    }

    async get() {
        // CMD_GET = 0x00
        await this.sendCommand(0x00);
        
        const lenBuf = await this.read(1);
        const len = lenBuf[0]; // N = number of bytes to follow - 1
        
        // Read the rest of the payload (N + 1 bytes)
        // This payload contains [Version, Command1, Command2, ...]
        const payload = await this.read(len + 1);
        
        const version = payload[0];
        this.commands = Array.from(payload.slice(1));
        
        await this.waitAck();
        return { version, cmds: this.commands };
    }

    async getId(): Promise<number> {
        // CMD_GET_ID = 0x02
        await this.sendCommand(0x02);
        
        const lenBuf = await this.read(1);
        const len = lenBuf[0]; // N = number of bytes to follow - 1
        
        // Payload: [PID] (usually 1 byte? No, ID is usually 2 bytes? or just PID?)
        // AN3155: Byte 1 = N (number of bytes - 1). 
        // Then N+1 bytes. 
        // Example: 0x01 (len=1) -> 0x04 0x10 (ID=0x410)
        
        const payload = await this.read(len + 1);
        await this.waitAck();
        
        if (payload.length >= 2) {
             return (payload[0] << 8) | payload[1];
        } else if (payload.length === 1) {
             return payload[0];
        }
        return 0;
    }

    async erasePages(pages: number[]) {
        if (this.commands.length === 0) {
            throw new Error("Execute GET command first (internal error)");
        }

        const CMD_ERASE = 0x43;
        const CMD_EXTENDED_ERASE = 0x44;
        const USE_EXTENDED = this.commands.includes(CMD_EXTENDED_ERASE);
        
        if (!USE_EXTENDED && !this.commands.includes(CMD_ERASE)) {
            throw new Error("No supported erase command found");
        }

        // Use Extended Erase (0x44) if available as it supports 2-byte page codes
        // Standard Erase (0x43) supports 1-byte page codes (0-255).
        // If we have pages > 255, we must use 0x44.

        // Chunk pages to avoid packet size limits (max 255 bytes payload)
        // Each page is 2 bytes in Extended (plus 2 bytes count).
        // Max pages per command ~125.
        
        const CHUNK_SIZE = USE_EXTENDED ? 60 : 250; // Safe limits

        for (let i = 0; i < pages.length; i += CHUNK_SIZE) {
            const chunk = pages.slice(i, i + CHUNK_SIZE);
            const N = chunk.length;
            
            if (USE_EXTENDED) {
                await this.sendCommand(CMD_EXTENDED_ERASE);
                
                // Payload: [N-1 (2 bytes)] [Page0 (2 bytes)] ... [Checksum]
                // N-1 is 2 bytes, MSB first.
                const count = N - 1;
                const data = new Uint8Array(2 + N * 2 + 1);
                data[0] = (count >> 8) & 0xFF;
                data[1] = count & 0xFF;
                
                let checksum = data[0] ^ data[1];
                
                for (let j = 0; j < N; j++) {
                    const page = chunk[j];
                    const msb = (page >> 8) & 0xFF;
                    const lsb = page & 0xFF;
                    data[2 + j*2] = msb;
                    data[2 + j*2 + 1] = lsb;
                    checksum ^= msb ^ lsb;
                }
                
                data[data.length - 1] = checksum;
                await this.write(data);
                
            } else {
                // Standard Erase 0x43 (0xFF is not used here)
                // Payload: [N-1 (1 byte)] [Page0 (1 byte)] ... [Checksum]
                await this.sendCommand(CMD_ERASE);
                
                const count = N - 1;
                const data = new Uint8Array(1 + N + 1);
                data[0] = count;
                let checksum = count;
                
                for (let j = 0; j < N; j++) {
                    const page = chunk[j];
                    if (page > 255) throw new Error(`Page ${page} too high for standard erase`);
                    data[1 + j] = page;
                    checksum ^= page;
                }
                data[data.length - 1] = checksum;
                await this.write(data);
            }
            
            await this.waitAck(5000 + N * 50); // Give time for erase
        }
    }

    async eraseAll() {
        if (this.commands.length === 0) {
            throw new Error("Execute GET command first (internal error)");
        }

        const CMD_ERASE = 0x43;
        const CMD_EXTENDED_ERASE = 0x44;

        if (this.commands.includes(CMD_EXTENDED_ERASE)) {
            // Extended Erase (0x44)
            // 0x44 -> ACK -> 0xFF 0xFF 0x00 (Global) -> ACK
            await this.sendCommand(CMD_EXTENDED_ERASE);
            // Global erase payload: 0xFFFF + checksum
            // 0xFF 0xFF -> XOR is 0x00.
            await this.write(new Uint8Array([0xFF, 0xFF, 0x00]));
            await this.waitAck(30000); // Erase is slow
        } else if (this.commands.includes(CMD_ERASE)) {
            // Standard Erase (0x43)
            // 0x43 -> ACK -> 0xFF (All) -> 0x00 (Checksum) -> ACK
            await this.sendCommand(CMD_ERASE);
            await this.write(new Uint8Array([0xFF, 0x00]));
            await this.waitAck(30000);
        } else {
            throw new Error("No supported erase command found (checked 0x43, 0x44)");
        }
    }

    async writeMemory(address: number, data: Uint8Array) {
        // CMD_WRITE = 0x31
        await this.sendCommand(0x31);
        
        // Send address
        const addrBuf = new Uint8Array(5);
        addrBuf[0] = (address >> 24) & 0xFF;
        addrBuf[1] = (address >> 16) & 0xFF;
        addrBuf[2] = (address >> 8) & 0xFF;
        addrBuf[3] = address & 0xFF;
        addrBuf[4] = addrBuf[0] ^ addrBuf[1] ^ addrBuf[2] ^ addrBuf[3]; // Checksum
        await this.write(addrBuf);
        await this.waitAck(); // ACK after address

        // Send data
        // N = data.length - 1
        // Data...
        // Checksum = N ^ data[0] ^ ... ^ data[N]
        
        const len = data.length - 1;
        let checksum = len;
        for (const b of data) checksum ^= b;
        
        const dataBuf = new Uint8Array(data.length + 2);
        dataBuf[0] = len;
        dataBuf.set(data, 1);
        dataBuf[dataBuf.length - 1] = checksum;
        
        await this.write(dataBuf);
        await this.waitAck(); // ACK after data
    }

    private async sendCommand(cmd: number) {
        const buf = new Uint8Array([cmd, cmd ^ 0xFF]);
        await this.write(buf);
        await this.waitAck();
    }

    private async waitAck(timeout = 2000) {
        const resp = await this.read(1, timeout);
        if (resp[0] !== 0x79) {
            throw new Error(`Expected ACK (0x79), got 0x${resp[0].toString(16)}`);
        }
    }

    private async write(data: Uint8Array) {
        await this.writer!.write(data);
    }

    private async read(len: number, timeout = 1000): Promise<Uint8Array> {
        const startTime = Date.now();
        
        while (this.rxBuffer.length < len) {
            if (Date.now() - startTime >= timeout) throw new Error("Read timeout");
            await new Promise(r => setTimeout(r, 10));
        }
        
        const result = new Uint8Array(this.rxBuffer.slice(0, len));
        this.rxBuffer = this.rxBuffer.slice(len);
        return result;
    }
}

// ------------------------------------
// Helpers
// ------------------------------------

function parseHex(hexText: string): { address: number, data: Uint8Array }[] {
    const blocks: { address: number, data: Uint8Array }[] = [];
    
    const lines = hexText.split(/\r?\n/);
    let highAddress = 0;
    let currentBuffer: number[] = [];
    let startAddress = -1;

    for (const line of lines) {
        if (line.length === 0 || line[0] !== ':') continue;
        
        // Parse basic fields
        const byteCount = parseInt(line.substring(1, 3), 16);
        const address = parseInt(line.substring(3, 7), 16);
        const recordType = parseInt(line.substring(7, 9), 16);
        const dataHex = line.substring(9, 9 + byteCount * 2);

        if (isNaN(byteCount) || isNaN(address) || isNaN(recordType)) {
             continue;
        }

        if (recordType === 0x00) { // Data Record
            const absAddress = highAddress + address;
            
            // Check continuity
            if (startAddress === -1) {
                startAddress = absAddress;
            } else if (absAddress !== startAddress + currentBuffer.length) {
                // Gap detected, flush previous block
                if (currentBuffer.length > 0) {
                    blocks.push({ address: startAddress, data: new Uint8Array(currentBuffer) });
                }
                startAddress = absAddress;
                currentBuffer = [];
            }

            for (let i = 0; i < byteCount; i++) {
                currentBuffer.push(parseInt(dataHex.substring(i * 2, i * 2 + 2), 16));
            }

        } else if (recordType === 0x01) { // End of File
            // Flush any remaining data
            if (currentBuffer.length > 0) {
                blocks.push({ address: startAddress, data: new Uint8Array(currentBuffer) });
            }
            break; // Stop parsing

        } else if (recordType === 0x02) { // Extended Segment Address
             // (segment << 4)
             const segment = parseInt(dataHex.substring(0, 4), 16);
             highAddress = segment << 4;
             if (currentBuffer.length > 0) {
                blocks.push({ address: startAddress, data: new Uint8Array(currentBuffer) });
                startAddress = -1;
                currentBuffer = [];
             }

        } else if (recordType === 0x04) { // Extended Linear Address
             // (upper << 16)
             const upper = parseInt(dataHex.substring(0, 4), 16);
             highAddress = upper << 16;
             
             if (currentBuffer.length > 0) {
                blocks.push({ address: startAddress, data: new Uint8Array(currentBuffer) });
                startAddress = -1;
                currentBuffer = [];
             }
        }
    }
    
    if (currentBuffer.length > 0) {
         const lastAdded = blocks.length > 0 ? blocks[blocks.length-1] : null;
         if (!lastAdded || lastAdded.address !== startAddress) {
             blocks.push({ address: startAddress, data: new Uint8Array(currentBuffer) });
         }
    }

    return blocks;
}
