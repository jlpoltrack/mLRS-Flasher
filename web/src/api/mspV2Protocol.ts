import { BufferedSerial } from './bufferedSerial';

export interface MspPort {
    index: number;
    name: string;
    functions: string[];
    baudRate?: number;
}

export const MSP2_COMMON_SERIAL_CONFIG = 0x1009;
export const MSP_REBOOT = 68;


// serial port functions (bitmask)
export const FUNCTION_MSP = (1 << 0);
export const FUNCTION_GPS = (1 << 1);
export const FUNCTION_RX_SERIAL = (1 << 6);
export const FUNCTION_BLACKBOX = (1 << 7);
export const FUNCTION_TELEMETRY_SMARTPORT = (1 << 5);
export const FUNCTION_VTX_SMARTAUDIO = (1 << 11);
export const FUNCTION_VTX_TRAMP = (1 << 13);
export const FUNCTION_TELEMETRY_MAVLINK = (1 << 9);

export class MspV2Protocol {
    private serial: BufferedSerial;
    private onLog?: (msg: string) => void;

    constructor(serial: BufferedSerial, onLog?: (msg: string) => void) {
        this.serial = serial;
        this.onLog = onLog;
    }

    private log(msg: string) {
        this.onLog?.(msg);
    }

    private toHex(data: Uint8Array | number[]): string {
        return Array.from(data).map(b => b.toString(16).padStart(2, '0')).join(' ');
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

    private async waitForHeader(): Promise<string> {
        const startTime = Date.now();
        const timeout = 3000;
        let garbage: number[] = [];

        while (Date.now() - startTime < timeout) {
            const byte = await this.serial.readByte(500).catch(() => null);
            if (byte === null) continue;

            if (byte === 36) { // '$'
                const next1 = await this.serial.readByte(500).catch(() => null);
                if (next1 === 88) { // 'X'
                    const next2 = await this.serial.readByte(500).catch(() => null);
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

    async sendCommand(cmd: number, payload: number[] = []): Promise<number[]> {
        const flag = 0; // request
        const size = payload.length;
        const crcData = [flag, cmd & 0xFF, (cmd >> 8) & 0xFF, size & 0xFF, (size >> 8) & 0xFF, ...payload];
        const crc = this.crc8DvbS2(crcData);
        const packet = new Uint8Array([36, 88, 60, ...crcData, crc]);

        // clear buffer before sending
        this.serial.flush();
        await this.serial.write(packet);

        const headerStr = await this.waitForHeader();
        const frameHeader = await this.serial.read(5, 3000); // flag, func(2), size(2)
        const respFlag = frameHeader[0];
        // little endian size
        const respSize = frameHeader[3] | (frameHeader[4] << 8);

        if (headerStr === '$X!') {
            await this.serial.read(respSize + 1, 3000); // consume payload + crc
            throw new Error(`FC rejected MSP2 cmd ${cmd}`);
        }
        
        const data = await this.serial.read(respSize + 1, 5000);
        const respPayload = Array.from(data.slice(0, respSize));
        const respCrc = data[respSize];
        
        const respCrcData = [respFlag, frameHeader[1], frameHeader[2], frameHeader[3], frameHeader[4], ...respPayload];
        if (this.crc8DvbS2(respCrcData) !== respCrc) {
            throw new Error(`MSP2 CRC Error`);
        }
        return respPayload;
    }
}
