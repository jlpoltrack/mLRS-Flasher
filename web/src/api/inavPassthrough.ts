import { BufferedSerial } from './bufferedSerial';
import { 
    MspV2Protocol, 
    MSP2_COMMON_SERIAL_CONFIG, 
    FUNCTION_MSP, 
    FUNCTION_GPS, 
    FUNCTION_RX_SERIAL, 
    FUNCTION_BLACKBOX, 
    FUNCTION_TELEMETRY_SMARTPORT, 
    FUNCTION_VTX_SMARTAUDIO, 
    FUNCTION_VTX_TRAMP, 
    FUNCTION_TELEMETRY_MAVLINK,
    MSP_REBOOT
} from './mspV2Protocol';
import type { MspPort } from './mspV2Protocol';

const REBOOT_WAIT_MS = 2000;

const INAV_BAUD_RATES = [
    0, // auto
    1200, 2400, 4800, 9600, 19200, 38400, 57600, 115200, 
    230400, 250000, 400000, 460800, 500000, 
    921600, 1000000, 1500000, 2000000, 2470000
];

export type { MspPort };

export class InavPassthroughService {
    private serial: BufferedSerial;
    private msp: MspV2Protocol;
    private onLog?: (msg: string) => void;

    constructor(port: SerialPort, onLog?: (msg: string) => void) {
        this.onLog = onLog;
        this.serial = new BufferedSerial(port, onLog);
        this.msp = new MspV2Protocol(this.serial, onLog);
    }

    private log(msg: string) {
        this.onLog?.(msg);
    }

    async connect() {
        await this.serial.connect({ baudRate: 115200 });
    }

    async disconnect() {
        await this.serial.disconnect();
    }

    async close() {
        await this.serial.close();
    }

    async reconnect(baudRate: number) {
        await this.serial.connect({ baudRate });
    }

    async getMspPorts(): Promise<MspPort[]> {
        try {
            const payload = await this.msp.sendCommand(MSP2_COMMON_SERIAL_CONFIG);
            
            const ENTRY_SIZE = 9;
            const count = Math.floor(payload.length / ENTRY_SIZE);
            const ports: MspPort[] = [];

            for (let i = 0; i < count; i++) {
                const offset = i * ENTRY_SIZE;
                const id = payload[offset];
                const mask = payload[offset + 1] | (payload[offset + 2] << 8) | (payload[offset + 3] << 16) | (payload[offset + 4] << 24);
                const mspBaudIndex = payload[offset + 5];
                
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
                     const baudRate = INAV_BAUD_RATES[mspBaudIndex] || 115200;
                     ports.push({
                         index: id,
                         baudRate: baudRate,
                         name: `UART ${id + 1}${functions.length > 0 ? ` (${functions.join(', ')}, ${baudRate})` : ''}`,
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

    async enterPassthrough(uartId: number, baud: number, sendReboot: boolean = false) {
        this.log(`Activating passthrough on UART ${uartId + 1} at ${baud} baud...`);

        // Ensure we are in CLI mode by sending newlines and hash
        await this.serial.write(new TextEncoder().encode('\n\n#\n'));
        await new Promise(r => setTimeout(r, 500));

        const cmd = `serialpassthrough ${uartId} ${baud}\n`;
        this.log(`Sending command: ${cmd.trim()}`);
        await this.serial.write(new TextEncoder().encode(cmd));

        // Wait for FC to enter passthrough mode
        await new Promise(r => setTimeout(r, 500));

        // For ESP (no reboot): reconnect at passthrough baud since esptool will use this speed
        // For STM32 (with reboot): caller already connected at correct baud before calling this
        if (!sendReboot) {
            await this.reconnect(baud);
            await new Promise(r => setTimeout(r, 500));
        }

        this.log("Passthrough active.");
        await new Promise(r => setTimeout(r, 500));

        if (sendReboot) {
            this.log("Sending MSP Reboot command to Rx...");
            // magic number 1234321 = 0x0012D591 (little endian: 91 D5 12 00)
            const payload = [0x91, 0xD5, 0x12, 0x00];
            await this.msp.sendCommand(MSP_REBOOT, payload);
            this.log("MSP Reboot ACK received.");

            // wait for reboot to complete
            this.log(`Waiting ${REBOOT_WAIT_MS}ms for receiver to reboot...`);
            await new Promise(r => setTimeout(r, REBOOT_WAIT_MS));
        }

        await this.close();
    }
}
