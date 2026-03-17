export class BufferedSerial {
    private port: SerialPort;
    private reader: ReadableStreamDefaultReader<Uint8Array> | null = null;
    private writer: WritableStreamDefaultWriter<Uint8Array> | null = null;
    private rxBuffer: number[] = [];
    private reading = false;
    private readResolver: (() => void) | null = null;
    private readingPromise: Promise<void> | null = null;
    private onLog?: (msg: string) => void;

    constructor(port: SerialPort, onLog?: (msg: string) => void) {
        this.port = port;
        this.onLog = onLog;
    }

    private log(msg: string) {
        this.onLog?.(msg);
    }

    async connect(options: SerialOptions = { baudRate: 115200 }) {
        this.rxBuffer = [];
        this.reading = false;

        // force cleanup if already open
        if (this.port.readable || this.port.writable) {
            await this.close();
        }

        await this.port.open(options);
        this.writer = this.port.writable!.getWriter();
        this.readingPromise = this.startReading();
    }

    async disconnect() {
        this.reading = false;
        
        if (this.reader) {
            try { await this.reader.cancel(); } catch {}
        }
        
        if (this.readingPromise) {
            try { await this.readingPromise; } catch {}
            this.readingPromise = null;
        }

        if (this.reader) {
            try { this.reader.releaseLock(); } catch {}
            this.reader = null;
        }

        if (this.writer) {
            try { this.writer.releaseLock(); } catch {}
            this.writer = null;
        }
    }

    async close() {
        await this.disconnect();
        try {
            await this.port.close();
            // allow OS time to release resource
            await new Promise(r => setTimeout(r, 100));
        } catch (e: any) {
            this.log(`Port close error: ${e?.message || e}`);
        }
    }

    private async startReading() {
        if (this.reading || !this.port.readable) return;
        this.reading = true;
        this.reader = this.port.readable.getReader();

        try {
            while (this.reading) {
                const { value, done } = await this.reader.read();
                if (done) break;
                if (value) {
                    for (let i = 0; i < value.length; i++) {
                        this.rxBuffer.push(value[i]);
                    }
                    if (this.readResolver) {
                        this.readResolver();
                        this.readResolver = null;
                    }
                }
            }
        } catch (e: any) {
             // Ignore errors on close/cancel
        } finally {
            this.reading = false;
            try { this.reader?.releaseLock(); } catch {}
            this.reader = null;
        }
    }

    async write(data: Uint8Array | number[]) {
        if (!this.writer) throw new Error("Port not open");
        const payload = data instanceof Uint8Array ? data : new Uint8Array(data);
        await this.writer.write(payload);
    }

    async read(length: number, timeout = 1000): Promise<Uint8Array> {
        const startTime = Date.now();

        while (this.rxBuffer.length < length) {
            const elapsed = Date.now() - startTime;
            if (elapsed >= timeout) {
                throw new Error("Read timeout");
            }

            await new Promise<void>((resolve) => {
                this.readResolver = resolve;
                setTimeout(() => {
                    if (this.readResolver === resolve) {
                        this.readResolver = null;
                        resolve();
                    }
                }, Math.min(100, timeout - elapsed));
            });
        }

        const result = new Uint8Array(this.rxBuffer.slice(0, length));
        this.rxBuffer = this.rxBuffer.slice(length);
        return result;
    }

    async readByte(timeout = 1000): Promise<number> {
        const buf = await this.read(1, timeout);
        return buf[0];
    }
    
    /**
     * non-blocking check for available bytes
     */
    get bytesAvailable(): number {
        return this.rxBuffer.length;
    }
    
    /**
     * clear the receive buffer
     */
    flush() {
        this.rxBuffer = [];
    }
}
