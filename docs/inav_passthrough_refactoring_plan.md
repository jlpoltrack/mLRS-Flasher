# INAV Passthrough Refactoring Plan

## Goal Description
The goal is to refactor `inavPassthrough.ts` to improve maintainability, reduce code duplication, and increase robustness. Currently, the serial reading logic is duplicated between `inavPassthrough.ts` and `stm32UartProtocol.ts`. The MSP V2 protocol logic is also mixed with the service logic.

## User Review Required
> [!NOTE]
> This refactoring involves creating new helper classes (`BufferedSerial`, `MspV2Protocol`).

## Proposed Changes

### Shared Utilities
#### [NEW] `web/src/api/bufferedSerial.ts`
This class wraps `SerialPort` to provide a robust, buffered read interface.

```typescript
export class BufferedSerial {
    constructor(private port: SerialPort, private onLog?: (msg: string) => void) {}

    // Stream management
    async connect(options?: SerialOptions): Promise<void>;
    async disconnect(): Promise<void>;
    async close(): Promise<void>;

    // I/O
    async write(data: Uint8Array): Promise<void>;
    async read(length: number, timeout?: number): Promise<Uint8Array>;
    async readByte(timeout?: number): Promise<number>;
    
    // Utilities
    flush(): void; // Clear buffer
}
```

#### [NEW] `web/src/api/mspV2Protocol.ts`
This class encapsulates the MSP V2 protocol logic, using `BufferedSerial` for transport.

```typescript
import { BufferedSerial } from './bufferedSerial';

export interface MspPort {
    index: number;
    name: string;
    functions: string[];
}

export const MSP2_COMMON_SERIAL_CONFIG = 0x1009;

// Bitmasks for serial function capabilities
export const FUNCTION_MSP = (1 << 0);
export const FUNCTION_GPS = (1 << 1);
// ... other constants ...

export class MspV2Protocol {
    constructor(private serial: BufferedSerial) {}

    async sendCommand(cmd: number, payload: number[] = []): Promise<number[]> {
        // - Constructs MSP2 packet with CRC
        // - Sends via this.serial.write()
        // - Waits for header ($X>) via buffer inspection
        // - Reads and verifies response
    }

    // Helper to scan for '$X>' or '$X!'
    private async waitForHeader(timeout: number): Promise<string>;
    
    // CRC8 implementation
    private crc8DvbS2(data: number[]): number;
}
```

### Refactored Components
#### [MODIFY] `web/src/api/inavPassthrough.ts`
Refactor to delegate low-level work to the new classes.

```typescript
export class InavPassthroughService {
    private serial: BufferedSerial;
    private msp: MspV2Protocol;

    constructor(port: SerialPort, onLog?: (msg: string) => void) {
        this.serial = new BufferedSerial(port, onLog);
        this.msp = new MspV2Protocol(this.serial);
    }

    async connect() {
        await this.serial.connect({ baudRate: 115200 });
    }

    async getMspPorts(): Promise<MspPort[]> {
        // Logic simplified:
        // return this.msp.sendCommand(MSP2_COMMON_SERIAL_CONFIG)...map(...)
    }

    async enterPassthrough(uartId: number, baud: number) {
        // Send CLI commands via this.serial.write()
        // Wait logic...
        await this.serial.close();
    }
}
```

#### [MODIFY] `web/src/api/stm32UartProtocol.ts`
Refactor to reuse `BufferedSerial`.

```typescript
export class Stm32UartProtocol {
    private serial: BufferedSerial;

    constructor(port: SerialPort, onLog?: (msg: string) => void) {
        this.serial = new BufferedSerial(port, onLog);
    }

    async connect() {
         // stm32 uses Even parity
         await this.serial.connect({ baudRate: 115200, parity: 'even', stopBits: 1 });
         // Sync logic using this.serial.write / this.serial.read
    }
    // ... existing logic adapted to use this.serial.read() ...
}
```

## Verification Plan
### Manual Verification
- Since I cannot run the hardware code, the user will need to verify:
    - Detection of MSP Ports in the UI.
    - Successful entry into Passthrough mode.
    - Flashing process stability (no timeouts or data corruption).

### Static Analysis
- Ensure TypeScript compiles without errors.
- Verify no circular dependencies.
- Verify `stm32UartProtocol` parity settings are correctly passed to `BufferedSerial`.
