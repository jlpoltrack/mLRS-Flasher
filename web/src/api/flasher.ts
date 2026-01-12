import { ESPLoader, Transport } from 'esptool-js';
import { WebDFU } from 'webdfu';

export interface FlasherOptions {
  chipset: string;
  baud?: number;
  reset?: string;
  erase?: string;
  onProgress?: (progress: number, status: string) => void;
  onLog?: (message: string) => void;
}

export async function flash(
  port: SerialPort | USBDevice,
  firmwareData: ArrayBuffer,
  options: FlasherOptions
): Promise<void> {
  const { chipset, onProgress, onLog } = options;

  onLog?.(`Starting flash process for chipset: ${chipset}...`);

  if (chipset.startsWith('esp')) {
    if (!(port instanceof SerialPort)) {
        throw new Error('ESP flashing requires a SerialPort');
    }
    return flashESP(port, firmwareData, options);
  } else if (chipset === 'stm32') {
    // In mLRS, 'stm32' can be DFU or UART depending on the target.
    // We'll need more logic here or the caller should specify.
    // For now, let's assume if it's a USBDevice it's DFU, else UART.
    if (port instanceof USBDevice) {
        return flashSTM32DFU(port, firmwareData, options);
    } else {
        return flashSTM32UART(port, firmwareData, options);
    }
  } else {
    throw new Error(`Unsupported chipset: ${chipset}`);
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
  
  try {
    const dfu = new WebDFU(device, { forceInterfacesName: true });
    await dfu.init();
    
    if (dfu.interfaces.length === 0) {
        throw new Error("No DFU interfaces found on device");
    }

    onLog?.(`Found ${dfu.interfaces.length} DFU interfaces. Connecting to first one...`);
    await dfu.connect(0);

    onLog?.("DFU connected. Beginning firmware download...");
    
    // WebDFU write takes a block size and the data
    const transferSize = 2048; // Common for STM32
    
    await dfu.write(transferSize, firmwareData, true); // true for manifestation
    
    onProgress?.(100, "Done");
    onLog?.("STM32 DFU Flash complete!");
    
    await dfu.detach();
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
  
  const protocol = new Stm32UartProtocol(port, onLog);
  try {
    await protocol.connect();
    onLog?.("Connected to STM32 bootloader.");

    const info = await protocol.get();
    onLog?.(`Bootloader version: ${info.version.toString(16)}`);

    onLog?.("Erasing flash...");
    await protocol.eraseAll();

    onLog?.("Writing firmware...");
    const data = new Uint8Array(firmwareData);
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
    throw err;
  }
}

class Stm32UartProtocol {
    private reader: ReadableStreamDefaultReader<Uint8Array> | null = null;
    private writer: WritableStreamDefaultWriter<Uint8Array> | null = null;
    private port: SerialPort;
    private onLog?: (msg: string) => void;

    constructor(port: SerialPort, onLog?: (msg: string) => void) {
        this.port = port;
        this.onLog = onLog;
    }

    async connect() {
        // STM32 bootloader uses 8E1, usually starts at 115200 or auto-bauds
        await this.port.open({ baudRate: 115200, parity: 'even' });
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
