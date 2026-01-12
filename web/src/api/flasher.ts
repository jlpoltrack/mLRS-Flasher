import { ESPLoader, Transport } from 'esptool-js';
import { DFU, DFUse } from 'webdfu';
// @ts-ignore
import intelhex from 'intel-hex';
import { Buffer } from 'buffer';

// Shim Buffer for libraries that expect it (like intel-hex)
if (typeof window !== 'undefined' && !(window as any).Buffer) {
    (window as any).Buffer = Buffer;
}

export interface FlasherOptions {
  chipset: string;
  baud?: number;
  reset?: string;
  erase?: string;
  onProgress?: (progress: number, status: string) => void;
  onLog?: (message: string) => void;
  targetType?: string; // rx, tx, txint
  filename?: string;
}

export async function flash(
  port: SerialPort | USBDevice,
  firmwareData: ArrayBuffer,
  options: FlasherOptions
): Promise<void> {
  const { chipset, onLog } = options;

  onLog?.(`Starting flash process for chipset: ${chipset}...`);

  if (chipset === 'stm32') {
    // For internal modules, we might need EdgeTX passthrough
    if (options.targetType === 'txint' && port.constructor.name === 'SerialPort') {
        onLog?.("Initializing EdgeTX Passthrough for internal module...");
        await initEdgeTXPassthrough(port as SerialPort, options.baud || 115200, onLog);
        // After passthrough, we may need to wait or slightly delay
        await new Promise(r => setTimeout(r, 500));
    }

    // In mLRS, 'stm32' can be DFU or UART depending on the target.
    if (port instanceof USBDevice) {
        return flashSTM32DFU(port, firmwareData, options);
    } else {
        return flashSTM32UART(port, firmwareData, options);
    }
  } else if (chipset.startsWith('esp')) {
     if (port.constructor.name !== 'SerialPort') {
         throw new Error('ESP flashing requires a SerialPort');
     }
     
     if (options.targetType === 'txint') {
         onLog?.("Initializing EdgeTX Passthrough for internal module...");
         await initEdgeTXPassthrough(port as SerialPort, options.baud || 115200, onLog);
         await new Promise(r => setTimeout(r, 500));
     }

     return flashESP(port as SerialPort, firmwareData, options);
  } else {
    throw new Error(`Unsupported chipset: ${chipset}`);
  }
}

export async function initEdgeTXPassthrough(
    port: SerialPort,
    baudrate: number,
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
        await executeCommand('set rfmod 0 bootpin 1', 'boot');
        
        onLog?.("Power cycling RF module...");
        await executeCommand('set rfmod 0 power off');
        await new Promise(r => setTimeout(r, 1000));
        await executeCommand('set rfmod 0 power on');
        await new Promise(r => setTimeout(r, 1000));

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

async function flashESP(
  port: SerialPort,
  firmwareData: ArrayBuffer,
  options: FlasherOptions
): Promise<void> {
  const { baud = 460800, erase, onProgress, onLog } = options;

  onLog?.("Connecting to ESP device...");
  
  const transport = new Transport(port);
  const esploader = new ESPLoader({
    transport: transport,
    baudrate: baud,
    terminal: {
        clean: () => {},
        writeLine: (data: string) => onLog?.(data),
        write: (data: string) => onLog?.(data),
    },
    romBaudrate: 115200,
  });

  try {
    const chip = await esploader.main();
    onLog?.(`Detected chip: ${chip}`);

    if (erase === 'full_erase') {
        onLog?.("Performing full erase...");
        await esploader.eraseFlash();
    }

    // esptool-js 0.5.x expects a specific format. Cast to any to avoid type mismatches
    // if the library types are slightly off.
    const fileArray = [{
        data: new Uint8Array(firmwareData) as any,
        address: 0x0,
    }];

    onLog?.("Writing flash...");
    await esploader.writeFlash({
        fileArray,
        flashSize: 'keep',
        flashMode: 'keep',
        flashFreq: 'keep',
        calculateMD5Hash: (_data: any) => "",
        reportProgress: (_fileIndex: number, written: number, total: number) => {
            const progress = Math.round((written / total) * 100);
            onProgress?.(progress, `Writing: ${progress}%`);
        }
    } as any);

    onLog?.("Flash complete!");
    await transport.disconnect();
  } catch (err: any) {
    onLog?.(`Error during ESP flash: ${err.message}`);
    throw err;
  }
}

async function flashSTM32DFU(
  device: USBDevice,
  firmwareData: ArrayBuffer,
  options: FlasherOptions
): Promise<void> {
  const { onProgress, onLog } = options;
  onLog?.("Starting STM32 DFU flash...");
  
  let binaryData = firmwareData;
  if (options.filename?.toLowerCase().endsWith('.hex')) {
      onLog?.("Converting Intel HEX to binary...");
      
      // Mimic hex2bin from mlrs.xyz / dfu-util.js
      const decoder = new TextDecoder('utf-8');
      const hexString = decoder.decode(firmwareData);
      const lines = hexString.split(/\r?\n/);
      const binary: number[] = [];

      lines.forEach(line => {
          if (line.length !== 0) {
              // Validate the line starts with ':'
              if (line[0] !== ':') {
                  // console.log(line);
                   // throw new Error("Invalid Intel HEX format"); // Loose parsing to be safe?
                   return; // Skip invalid lines
              }

              // Extract length, address, type, and data
              const length = parseInt(line.substring(1, 3), 16);
              const recordType = parseInt(line.substring(7, 9), 16);
              const data = line.substring(9, 9 + length * 2);

              // Only handle data records (type 00)
              if (recordType === 0) {
                  for (let i = 0; i < length; i++) {
                      const byte = parseInt(data.substring(i * 2, i * 2 + 2), 16);
                      binary.push(byte);
                  }
              }
          }
      });
      
      // Convert binary array to ArrayBuffer
      binaryData = new Uint8Array(binary).buffer;
      onLog?.(`HEX converted: ${binaryData.byteLength} bytes`);
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
        onLog?.("Reading interface names from device descriptors...");
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
    onLog?.(`Found DFU interface: ${settings.name || 'Unnamed'} (Alt ${settings.alternate.alternateSetting})`);

    // 3. Create initial DFU device instance to read descriptors
    let dfu: InstanceType<typeof DFU.Device> | InstanceType<typeof DFUse.Device> = new DFU.Device(device, settings);

    // 4. Hook up logging helper
    let lastLoggedProgress = 0;
    const setupLogging = (dev: any) => {
        dev.logDebug = (msg: string) => console.debug(msg);
        dev.logInfo = (msg: string) => onLog?.(msg);
        dev.logWarning = (msg: string) => onLog?.(`Warning: ${msg}`);
        dev.logError = (msg: string) => onLog?.(`Error: ${msg}`);
        dev.logProgress = (done: number, total: number) => {
            if (total) {
                const progress = Math.round((done / total) * 100);
                onProgress?.(progress, `Flash: ${progress}%`);
                
                // Reset tracker if a new operation starts (progress drops)
                if (progress < lastLoggedProgress) {
                    lastLoggedProgress = 0;
                }

                // Log every 10% (when the 10s digit changes) or at 100%
                if (progress === 100 || Math.floor(progress / 10) > Math.floor(lastLoggedProgress / 10)) {
                    onLog?.(`Progress: ${progress}%`);
                    lastLoggedProgress = progress;
                }
            } else {
                 onProgress?.(0, `Flash: ${done} bytes`);
            }
        };
    };
    setupLogging(dfu);

    onLog?.("Opening DFU device...");
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
            onLog?.(`DFU Descriptor: Version=0x${dfuVersion.toString(16)}, ManifestationTolerant=${manifestationTolerant}, TransferSize=${transferSize}`);
        }
        
    } catch (error) {
         onLog?.(`Warning: Failed to read DFU descriptor. Error: ${error}`);
    }

    // 6. If DFU version is 0x011a (DFuSe) and in DFU mode, switch to DFUse.Device
    if (dfuVersion === 0x011a && settings.alternate.interfaceProtocol === 0x02) {
        onLog?.("DFuSe protocol detected. Switching to DFUse device...");
        await dfu.close();
        dfu = new DFUse.Device(device, settings);
        setupLogging(dfu);
        await dfu.open();
        
        // Check memory info and set start address
        const dfuseDevice = dfu as InstanceType<typeof DFUse.Device>;
        if (dfuseDevice.memoryInfo) {
            onLog?.(`Memory: ${dfuseDevice.memoryInfo.name}`);
            let totalSize = 0;
            for (let segment of dfuseDevice.memoryInfo.segments) {
                totalSize += segment.end - segment.start;
            }
            onLog?.(`Total writable: ${(totalSize / 1024).toFixed(1)} KB`);
            
            // Set start address to first writable segment to avoid "inferred" warning
            const firstWritable = dfuseDevice.memoryInfo.segments.find(s => s.writable);
            if (firstWritable) {
                dfuseDevice.startAddress = firstWritable.start;
                onLog?.(`Start address: 0x${firstWritable.start.toString(16)}`);
            }
        } else {
            onLog?.("Warning: No memory info parsed from interface name.");
        }
    }

    onLog?.("DFU connected. Beginning firmware download...");
    
    // do_download handles the whole process including manifestation
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
            onLog?.("Device reset successfully (connection lost as expected).");
        } else {
            throw error;
        }
    }

    onLog?.("STM32 DFU Flash complete!");
    
    // Attempt closure if still connected
    try {
        await dfu.close(); 
    } catch (e) { /* ignore */ }
    
  } catch (err: any) {
    onLog?.(`Error during STM32 DFU flash: ${err.message}`);
    throw err;
  }
}

async function flashSTM32UART(
  port: SerialPort,
  firmwareData: ArrayBuffer,
  options: FlasherOptions
): Promise<void> {
  const { onProgress, onLog } = options;
  onLog?.("Starting STM32 UART flash (AN2606)...");
  onLog?.("Ensure device is in bootloader mode (usually by holding BOOT button while powering up).");

  let binaryData = firmwareData;
  if (options.filename?.toLowerCase().endsWith('.hex')) {
      onLog?.("Converting Intel HEX to binary...");
      const hexText = new TextDecoder().decode(firmwareData);
      
      // Calculate offset (avoid 250MB buffers)
      let addressOffset = 0;
      const hexLines = hexText.split('\n');
      for (const line of hexLines) {
          if (line.startsWith(':02000004')) {
              addressOffset = parseInt(line.substring(9, 13), 16) << 16;
              break;
          }
      }
      onLog?.(`Using address offset: 0x${addressOffset.toString(16)}`);
      
      const parsed = intelhex.parse(hexText, 0, addressOffset);
      const dataBuf = (parsed.data || parsed);
      binaryData = dataBuf.buffer ? dataBuf.buffer.slice(dataBuf.byteOffset, dataBuf.byteOffset + dataBuf.byteLength) : dataBuf;
      onLog?.(`HEX converted: ${binaryData.byteLength} bytes`);
  }
  
  const protocol = new Stm32UartProtocol(port, onLog);
  try {
    await protocol.connect();
    onLog?.("Connected to STM32 bootloader.");

    const info = await protocol.get();
    onLog?.(`Bootloader version: ${info.version.toString(16)}`);

    onLog?.("Erasing flash...");
    await protocol.eraseAll();

    onLog?.("Writing firmware...");
    const data = new Uint8Array(binaryData);
    const total = data.length;
    let written = 0;
    const chunkSize = 256;

    while (written < total) {
        const remaining = total - written;
        const currentChunkSize = Math.min(remaining, chunkSize);
        const chunk = data.slice(written, written + currentChunkSize);
        
        await protocol.writeMemory(0x08000000 + written, chunk);
        
        written += currentChunkSize;
        const progress = Math.round((written / total) * 100);
        onProgress?.(progress, `Writing: ${progress}%`);
    }

    onLog?.("STM32 UART Flash complete!");
  } catch (err: any) {
    onLog?.(`Error during STM32 UART flash: ${err.message}`);
    if (err.message.includes("no ACK") || err.message.includes("timeout")) {
        onLog?.("Hint: Check your connections and ensure the device is in bootloader mode.");
    }
    throw err;
  }
}

class Stm32UartProtocol {
    private reader: ReadableStreamDefaultReader<Uint8Array> | null = null;
    private writer: WritableStreamDefaultWriter<Uint8Array> | null = null;
    private port: SerialPort;
    // @ts-ignore
    private onLog?: (msg: string) => void;

    constructor(port: SerialPort, onLog?: (msg: string) => void) {
        this.port = port;
        this.onLog = onLog;
    }

    async connect() {
        // STM32 bootloader uses 8E1, usually starts at 115200 or auto-bauds
        await (this.port as any).open({ baudRate: 115200, parity: 'even' });
        this.reader = this.port.readable!.getReader();
        this.writer = this.port.writable!.getWriter();

        // Send synchronization byte
        await this.write(new Uint8Array([0x7F]));
        const resp = await this.read(1, 1000);
        if (resp[0] !== 0x79) {
            throw new Error("Failed to sync with bootloader (no ACK)");
        }
    }

    async get() {
        await this.sendCommand(0x00);
        const len = (await this.read(1))[0];
        const version = (await this.read(1))[0];
        const cmds = await this.read(len);
        await this.waitAck();
        return { version, cmds };
    }

    async eraseAll() {
        // Extended Erase (0x44) or Global Erase (0x43)
        // For simplicity, attempt Extended Erase special value for global
        await this.sendCommand(0x44);
        await this.write(new Uint8Array([0xFF, 0xFF, 0x00])); // Special 0xFFFF for global erase + checksum
        await this.waitAck(20000); // Erase can take a long time
    }

    async writeMemory(address: number, data: Uint8Array) {
        await this.sendCommand(0x31);
        
        // Send address
        const addrBuf = new Uint8Array(5);
        addrBuf[0] = (address >> 24) & 0xFF;
        addrBuf[1] = (address >> 16) & 0xFF;
        addrBuf[2] = (address >> 8) & 0xFF;
        addrBuf[3] = address & 0xFF;
        addrBuf[4] = addrBuf[0] ^ addrBuf[1] ^ addrBuf[2] ^ addrBuf[3];
        await this.write(addrBuf);
        await this.waitAck();

        // Send data
        const len = data.length - 1;
        let checksum = len;
        for (const b of data) checksum ^= b;
        
        const dataBuf = new Uint8Array(data.length + 2);
        dataBuf[0] = len;
        dataBuf.set(data, 1);
        dataBuf[dataBuf.length - 1] = checksum;
        
        await this.write(dataBuf);
        await this.waitAck();
    }

    private async sendCommand(cmd: number) {
        const buf = new Uint8Array([cmd, cmd ^ 0xFF]);
        await this.write(buf);
        await this.waitAck();
    }

    private async waitAck(timeout = 2000) {
        const resp = await this.read(1, timeout);
        if (resp[0] !== 0x79) {
            throw new Error(`Expected ACK (0x79), got ${resp[0].toString(16)}`);
        }
    }

    private async write(data: Uint8Array) {
        await this.writer!.write(data);
    }

    private async read(len: number, timeout = 1000): Promise<Uint8Array> {
        const result = new Uint8Array(len);
        let received = 0;

        const timeoutId = setTimeout(() => {
            throw new Error("Read timeout");
        }, timeout);

        try {
            while (received < len) {
                const { value, done } = await this.reader!.read();
                if (done) throw new Error("Stream closed");
                if (value) {
                    const toCopy = Math.min(value.length, len - received);
                    result.set(value.slice(0, toCopy), received);
                    received += toCopy;
                }
            }
        } finally {
            clearTimeout(timeoutId);
        }
        return result;
    }
}
