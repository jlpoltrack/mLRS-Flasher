// stm32 uart bootloader protocol implementation
// implements AN3155 USART protocol for STM32 bootloader communication

import { BufferedSerial } from './bufferedSerial';

/**
 * STM32 UART bootloader protocol handler
 * implements synchronization, read/write/erase commands per AN3155
 */
export class Stm32UartProtocol {
    private serial: BufferedSerial;
    private onLog?: (msg: string) => void;
    private commands: number[] = [];

    constructor(port: SerialPort, onLog?: (msg: string) => void) {
        this.serial = new BufferedSerial(port, onLog);
        this.onLog = onLog;
    }

    async connect() {
        // Check if port is already open (in a way the BufferedSerial might know or we can infer)
        // With BufferedSerial, we usually just call connect(). 
        // However, we want to respect the "already open" passthrough logic if possible.
        // We'll trust the BufferedSerial.connect to handle re-opening or options update.
        
        try {
            await this.serial.connect({ baudRate: 115200, parity: 'even', stopBits: 1 });
        } catch (e) {
            this.onLog?.("Connection might already be active or failed, checking sync...");
        }
        
        this.onLog?.("Flushing serial buffer...");
        this.serial.flush();

        // wait a moment for bootloader to be ready (prevents initial timeout)
        await new Promise(r => setTimeout(r, 500));

        // retry sync a few times
        for (let attempt = 1; attempt <= 3; attempt++) {
            this.onLog?.(`[TX] Sync (0x7F) - Attempt ${attempt}...`);
            try {
                await this.serial.write(new Uint8Array([0x7F]));
                const resp = await this.serial.read(1, 1500); // 1.5s timeout
                
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
            
            await new Promise(r => setTimeout(r, 500));
        }
        
        throw new Error("Failed to sync with bootloader after 3 attempts. Ensure device is in bootloader mode.");
    }

    async disconnect() {
        await this.serial.close();
    }

    async get() {
        // CMD_GET = 0x00
        await this.sendCommand(0x00);
        
        const lenBuf = await this.serial.read(1);
        const len = lenBuf[0]; // N = number of bytes to follow - 1
        
        // read the rest of the payload (N + 1 bytes)
        // this payload contains [Version, Command1, Command2, ...]
        const payload = await this.serial.read(len + 1);
        
        const version = payload[0];
        this.commands = Array.from(payload.slice(1));
        
        await this.waitAck();
        return { version, cmds: this.commands };
    }

    async getId(): Promise<number> {
        // CMD_GET_ID = 0x02
        await this.sendCommand(0x02);
        
        const lenBuf = await this.serial.read(1);
        const len = lenBuf[0]; // N = number of bytes to follow - 1
        
        // payload: [PID] 
        // AN3155: Byte 1 = N (number of bytes - 1). 
        // then N+1 bytes. 
        // example: 0x01 (len=1) -> 0x04 0x10 (ID=0x410)
        
        const payload = await this.serial.read(len + 1);
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

        const CHUNK_SIZE = USE_EXTENDED ? 60 : 250; // safe limits

        for (let i = 0; i < pages.length; i += CHUNK_SIZE) {
            const chunk = pages.slice(i, i + CHUNK_SIZE);
            const N = chunk.length;
            
            if (USE_EXTENDED) {
                await this.sendCommand(CMD_EXTENDED_ERASE);
                
                // payload: [N-1 (2 bytes)] [Page0 (2 bytes)] ... [Checksum]
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
                await this.serial.write(data);
                
            } else {
                // standard erase 0x43 (0xFF is not used here)
                // payload: [N-1 (1 byte)] [Page0 (1 byte)] ... [Checksum]
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
                await this.serial.write(data);
            }
            
            await this.waitAck(5000 + N * 50); // give time for erase
        }
    }

    async eraseAll() {
        if (this.commands.length === 0) {
            throw new Error("Execute GET command first (internal error)");
        }

        const CMD_ERASE = 0x43;
        const CMD_EXTENDED_ERASE = 0x44;

        if (this.commands.includes(CMD_EXTENDED_ERASE)) {
            // extended erase (0x44)
            // 0x44 -> ACK -> 0xFF 0xFF 0x00 (Global) -> ACK
            await this.sendCommand(CMD_EXTENDED_ERASE);
            // global erase payload: 0xFFFF + checksum
            // 0xFF 0xFF -> XOR is 0x00.
            await this.serial.write(new Uint8Array([0xFF, 0xFF, 0x00]));
            await this.waitAck(30000); // erase is slow
        } else if (this.commands.includes(CMD_ERASE)) {
            // standard erase (0x43)
            // 0x43 -> ACK -> 0xFF (All) -> 0x00 (Checksum) -> ACK
            await this.sendCommand(CMD_ERASE);
            await this.serial.write(new Uint8Array([0xFF, 0x00]));
            await this.waitAck(30000);
        } else {
            throw new Error("No supported erase command found (checked 0x43, 0x44)");
        }
    }

    async writeMemory(address: number, data: Uint8Array) {
        // CMD_WRITE = 0x31
        await this.sendCommand(0x31);
        
        // send address
        const addrBuf = new Uint8Array(5);
        addrBuf[0] = (address >> 24) & 0xFF;
        addrBuf[1] = (address >> 16) & 0xFF;
        addrBuf[2] = (address >> 8) & 0xFF;
        addrBuf[3] = address & 0xFF;
        addrBuf[4] = addrBuf[0] ^ addrBuf[1] ^ addrBuf[2] ^ addrBuf[3]; // checksum
        await this.serial.write(addrBuf);
        await this.waitAck(); // ACK after address

        // send data
        // N = data.length - 1
        // Data...
        // checksum = N ^ data[0] ^ ... ^ data[N]
        
        const len = data.length - 1;
        let checksum = len;
        for (const b of data) checksum ^= b;
        
        const dataBuf = new Uint8Array(data.length + 2);
        dataBuf[0] = len;
        dataBuf.set(data, 1);
        dataBuf[dataBuf.length - 1] = checksum;
        
        await this.serial.write(dataBuf);
        await this.waitAck(); // ACK after data
    }

    async readMemory(address: number, length: number): Promise<Uint8Array> {
        if (length <= 0 || length > 256) throw new Error("Read length must be between 1 and 256");

        // CMD_READ = 0x11
        await this.sendCommand(0x11);
        
        // send address
        const addrBuf = new Uint8Array(5);
        addrBuf[0] = (address >> 24) & 0xFF;
        addrBuf[1] = (address >> 16) & 0xFF;
        addrBuf[2] = (address >> 8) & 0xFF;
        addrBuf[3] = address & 0xFF;
        addrBuf[4] = addrBuf[0] ^ addrBuf[1] ^ addrBuf[2] ^ addrBuf[3]; // checksum
        await this.serial.write(addrBuf);
        await this.waitAck(); // ACK after address

        // send N (length - 1) + Checksum (~N)
        const N = length - 1;
        await this.serial.write(new Uint8Array([N, N ^ 0xFF]));
        await this.waitAck(); // ACK after length

        return await this.serial.read(length);
    }

    private async sendCommand(cmd: number) {
        const buf = new Uint8Array([cmd, cmd ^ 0xFF]);
        await this.serial.write(buf);
        await this.waitAck();
    }

    private async waitAck(timeout = 2000) {
        const resp = await this.serial.read(1, timeout);
        if (resp[0] !== 0x79) {
            throw new Error(`Expected ACK (0x79), got 0x${resp[0].toString(16)}`);
        }
    }
}
