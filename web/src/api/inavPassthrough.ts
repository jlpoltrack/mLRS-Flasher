// 2026-01-16
const MSP2_COMMON_SERIAL_CONFIG = 0x1009;  // Common MSP V2 (4105)

// Serial Port Functions (Bitmask)
const FUNCTION_MSP = (1 << 0);
const FUNCTION_GPS = (1 << 1);
const FUNCTION_RX_SERIAL = (1 << 6);
const FUNCTION_BLACKBOX = (1 << 7);
const FUNCTION_TELEMETRY_SMARTPORT = (1 << 5);
const FUNCTION_VTX_SMARTAUDIO = (1 << 11);
const FUNCTION_VTX_TRAMP = (1 << 13);
const FUNCTION_TELEMETRY_MAVLINK = (1 << 9);


export interface MspPort {
    index: number;
    name: string;
    functions: string[];
}

export class InavPassthroughService {
    private port: SerialPort;
    private reader: ReadableStreamDefaultReader<Uint8Array> | null = null;
    private writer: WritableStreamDefaultWriter<Uint8Array> | null = null;
    private readingPromise: Promise<void> | null = null;
    private onLog?: (msg: string) => void;
    private rxBuffer: number[] = [];
    private reading = false;

    constructor(port: SerialPort, onLog?: (msg: string) => void) {
        this.port = port;
        this.onLog = onLog;
    }

    private log(msg: string) {
        this.onLog?.(msg);
    }

    private toHex(data: Uint8Array | number[]): string {
        return Array.from(data).map(b => b.toString(16).padStart(2, '0')).join(' ');
    }

    private async write(data: Uint8Array) {
        if (!this.writer) throw new Error("Port not open");
        this.log(`WRITE: ${this.toHex(data)}`);
        await this.writer.write(data);
    }

    private async startReading() {
        if (this.reading || !this.port.readable) return;
        this.reading = true;
        this.reader = this.port.readable.getReader();

        this.log("Background reader started.");
        try {
            while (this.reading) {
                const { value, done } = await this.reader.read();
                if (done) break;
                if (value) {
                    for (let i = 0; i < value.length; i++) {
                        this.rxBuffer.push(value[i]);
                    }
                }
            }
        } catch (e: any) {
            this.log(`Read loop error: ${e?.message || e}`);
        } finally {
            this.reading = false;
            try { this.reader.releaseLock(); } catch {}
            this.reader = null;
            this.log("Background reader stopped.");
        }
    }

    private async read(length: number, timeout = 1000): Promise<Uint8Array> {
        const buffer = new Uint8Array(length);
        let received = 0;
        const startTime = Date.now();

        while (received < length) {
            if (this.rxBuffer.length > 0) {
                buffer[received++] = this.rxBuffer.shift()!;
                continue;
            }

            if (Date.now() - startTime > timeout) {
                this.log(`READ TIMEOUT: Got ${received}/${length}. Data: ${this.toHex(buffer.slice(0, received))}`);
                throw new Error("Read timeout");
            }

            // Small delay to prevent busy looping
            await new Promise(r => setTimeout(r, 10));
        }
        return buffer;
    }

    private async readByte(timeout = 1000): Promise<number> {
        const buf = await this.read(1, timeout);
        return buf[0];
    }

    private async waitForHeader(): Promise<string> {
        const startTime = Date.now();
        const timeout = 3000;
        let garbage: number[] = [];

        while (Date.now() - startTime < timeout) {
            const byte = await this.readByte(500).catch(() => null);
            if (byte === null) continue;

            if (byte === 36) { // '$'
                const next1 = await this.readByte(200).catch(() => null);
                if (next1 === 88) { // 'X'
                    const next2 = await this.readByte(200).catch(() => null);
                    if (next2 === 62) return '$X>'; // success
                    if (next2 === 33) return '$X!'; // error
                }
                garbage.push(byte);
                if (next1 !== null) garbage.push(next1);
            } else {
                garbage.push(byte);
            }

            if (garbage.length > 32) {
                this.log(`Discarded noise: ${this.toHex(garbage)}`);
                garbage = [];
            }
        }
        throw new Error("MSP Header Timeout - No response from FC");
    }

    private crc8DvbS2(data: number[]): number {
        let crc = 0;
        for (const byte of data) {
            crc ^= byte;
            for (let i = 0; i < 8; i++) {
                if (crc & 0x80) {
                    crc = ((crc << 1) ^ 0xD5) & 0xFF;
                } else {
                    crc = (crc << 1) & 0xFF;
                }
            }
        }
        return crc;
    }

    private async sendMspV2Command(cmd: number, payload: number[] = []): Promise<number[]> {
        const flag = 0; // request
        const size = payload.length;
        const crcData = [flag, cmd & 0xFF, (cmd >> 8) & 0xFF, size & 0xFF, (size >> 8) & 0xFF, ...payload];
        const crc = this.crc8DvbS2(crcData);
        const packet = new Uint8Array([36, 88, 60, ...crcData, crc]);

        this.log(`SEND V2 [${cmd}]`);
        // clear buffer before sending
        this.rxBuffer = [];
        await this.write(packet);

        const headerStr = await this.waitForHeader();
        const frameHeader = await this.read(5, 3000); // flag, func(2), size(2)
        const respFlag = frameHeader[0];
        const respSize = frameHeader[3] | (frameHeader[4] << 8);

        if (headerStr === '$X!') {
            await this.read(respSize + 1, 3000); // consume payload + crc
            throw new Error(`FC rejected MSP2 cmd ${cmd}`);
        }
        
        const data = await this.read(respSize + 1, 5000);
        const respPayload = Array.from(data.slice(0, respSize));
        const respCrc = data[respSize];
        
        const respCrcData = [respFlag, frameHeader[1], frameHeader[2], frameHeader[3], frameHeader[4], ...respPayload];
        if (this.crc8DvbS2(respCrcData) !== respCrc) {
            throw new Error(`MSP2 CRC Error`);
        }
        return respPayload;
    }

    async connect() {
        this.log("Initializing Web Serial connection...");
        this.rxBuffer = [];
        this.reading = false;

        // Force closure and re-open to ensure correct baud rate and clean state
        if (this.port.readable || this.port.writable) {
            this.log("Port was already open, cycling state...");
            
            // Release any existing locks before closing
            this.reading = false;
            if (this.reader) {
                try { await this.reader.cancel(); } catch {}
                try { this.reader.releaseLock(); } catch {}
                this.reader = null;
            }
            if (this.writer) {
                try { this.writer.releaseLock(); } catch {}
                this.writer = null;
            }
            
            // Small delay for stream cleanup
            await new Promise(r => setTimeout(r, 100));
            
            try { 
                await this.port.close(); 
                this.log("Port closed for cycling.");
            } catch (e: any) {
                this.log(`Port close during cycle failed: ${e?.message || e}`);
            }
            await new Promise(r => setTimeout(r, 200));
        }
        
        this.log("Opening port at 115200...");
        await this.port.open({ baudRate: 115200 });

        this.log("Configuring control lines (DTR/RTS)...");
        await this.port.setSignals({ dataTerminalReady: true, requestToSend: true });
        
        this.writer = this.port.writable!.getWriter();
        this.readingPromise = this.startReading();
        
        this.log("Waiting for FC to settle...");
        await new Promise(r => setTimeout(r, 1000));
        const initialGarbage = this.rxBuffer.length;
        this.rxBuffer = [];
        if (initialGarbage > 0) this.log(`Cleared ${initialGarbage} bytes from settle period.`);
    }

    /**
     * Release stream locks without closing the port.
     * Use this for temporary disconnection when you need to reuse the same port later.
     */
    async disconnect() {
        this.log("Disconnecting (releasing locks)...");
        
        // Signal read loop to stop
        this.reading = false;
        
        // Cancel reader to unblock read()
        if (this.reader) {
            this.log("Cancelling reader...");
            try { 
                await this.reader.cancel(); 
            } catch (e: any) {
                this.log(`Reader cancel: ${e?.message || e}`);
            }
        }
        
        // Wait for the background reader to fully exit
        if (this.readingPromise) {
            this.log("Waiting for reader loop to exit...");
            try {
                await this.readingPromise;
            } catch (e: any) {
                this.log(`Reader loop exit: ${e?.message || e}`);
            }
            this.readingPromise = null;
        }
        
        // Final cleanup in case reader wasn't fully released
        if (this.reader) {
            this.log("Force-releasing reader lock...");
            try { this.reader.releaseLock(); } catch {}
            this.reader = null;
        }
        
        // Release writer lock
        if (this.writer) {
            this.log("Releasing writer lock...");
            try { this.writer.releaseLock(); } catch {}
            this.writer = null;
        }
        
        this.log("Disconnect complete.");
    }

    /**
     * Fully close the serial port. Call this when completely done with the port.
     */
    async close() {
        this.log("Closing serial connection...");
        
        // First release all locks
        await this.disconnect();
        
        // Now close the port
        try { 
            await this.port.close(); 
            this.log("Port closed successfully.");
            // give the OS time to fully release the port
            await new Promise(r => setTimeout(r, 200));
        } catch (e: any) {
            this.log(`Port close error: ${e?.message || e}`);
            throw e; // Re-throw so caller knows it failed
        }
    }

    async getMspPorts(): Promise<MspPort[]> {
        this.log("Requesting serial configuration...");
        try {
            const payload = await this.sendMspV2Command(MSP2_COMMON_SERIAL_CONFIG);
            
            const ENTRY_SIZE = 9;
            const count = Math.floor(payload.length / ENTRY_SIZE);
            const ports: MspPort[] = [];

            for (let i = 0; i < count; i++) {
                const offset = i * ENTRY_SIZE;
                const id = payload[offset];
                const mask = payload[offset + 1] | (payload[offset + 2] << 8) | (payload[offset + 3] << 16) | (payload[offset + 4] << 24);
                const functions: string[] = [];
                if (mask & FUNCTION_MSP) functions.push('MSP');
                if (mask & FUNCTION_GPS) functions.push('GPS');
                if (mask & FUNCTION_RX_SERIAL) functions.push('Serial RX');
                if (mask & FUNCTION_BLACKBOX) functions.push('Blackbox');
                if (mask & FUNCTION_TELEMETRY_SMARTPORT) functions.push('SmartPort');
                if (mask & FUNCTION_VTX_SMARTAUDIO) functions.push('SmartAudio');
                if (mask & FUNCTION_VTX_TRAMP) functions.push('Tramp');
                if (mask & FUNCTION_TELEMETRY_MAVLINK) functions.push('Mavlink');
                if (id < 20 && (mask & FUNCTION_MSP)) {
                     ports.push({
                         index: id,
                         name: `UART ${id + 1}${functions.length > 0 ? ` (${functions.join(', ')})` : ''}`,
                         functions: functions
                     });
                }
            }
            return ports;
        } catch (e: any) {
            this.log(`MSP V2 Scan failed: ${e.message}`);
            // Fallback: Return standard UARTs so user isn't blocked
            return Array.from({length: 8}, (_, i) => ({ index: i, name: `UART ${i + 1}`, functions: [] }));
        }
    }

    async enterPassthrough(uartId: number, baud: number) {
        this.log(">>> enterPassthrough() started.");
        this.log(`Commanding FC to redirect UART ${uartId + 1} at ${baud} baud...`);
        
        // Ensure we are in CLI mode by sending newlines and hash
        await this.write(new TextEncoder().encode('\n\n#\n'));
        this.log("Waiting 1500ms for CLI to stabilize...");
        await new Promise(r => setTimeout(r, 1500));
        
        // Log what we got back from the prefix
        const entryNoiseCount = this.rxBuffer.length;
        if (entryNoiseCount > 0) {
            const noise = Uint8Array.from(this.rxBuffer);
            const ascii = new TextDecoder().decode(noise).replace(/[^\x20-\x7E]/g, '.');
            this.log(`CLI Entry Noise (${entryNoiseCount} bytes): [HEX: ${this.toHex(this.rxBuffer)}] [ASCII: ${ascii}]`);
            this.rxBuffer = [];
        } else {
            this.log("CLI Entry: No noise detected in buffer.");
        }
        
        const cmd = `serialpassthrough ${uartId} ${baud}\n`;
        await this.write(new TextEncoder().encode(cmd));
        
        // Wait for FC to switch - increased to ensure stabilization
        this.log("Waiting 1500ms for passthrough to activate...");
        await new Promise(r => setTimeout(r, 1500));
        
        const noiseCount = this.rxBuffer.length;
        if (noiseCount > 0) {
            const noise = Uint8Array.from(this.rxBuffer);
            const ascii = new TextDecoder().decode(noise).replace(/[^\x20-\x7E]/g, '.');
            this.log(`Transition Noise (${noiseCount} bytes): [HEX: ${this.toHex(this.rxBuffer)}] [ASCII: ${ascii}]`);
            this.rxBuffer = [];
        } else {
            this.log("Transition: No noise detected in buffer.");
        }

        this.log("Passthrough active. Final flush before close...");
        // Wait another bit to capture any trailing echoes
        await new Promise(r => setTimeout(r, 500));
        if (this.rxBuffer.length > 0) {
            this.log(`Late noise captured: ${this.toHex(this.rxBuffer)}`);
            this.rxBuffer = [];
        }

        this.log(">>> Calling close() to release port...");
        try {
            await this.close();
            this.log(">>> close() completed successfully.");
        } catch (e: any) {
            this.log(`>>> close() FAILED: ${e?.message || e}`);
            throw e;
        }
    }
}
