import { MavLinkPacketSplitter, MavLinkPacketParser, MavLinkData, MavLinkProtocolV2, minimal, common } from 'node-mavlink';
import type { MavLinkPacket } from 'node-mavlink';
const REBOOT_WAIT_MS = 2000;

// ------------------------------------
// Message Definitions
// ------------------------------------

// ------------------------------------
// Constants
// ------------------------------------
const MAV_AUTOPILOT_ARDUPILOTMEGA = 3;
const MAV_CMD_PREFLIGHT_REBOOT_SHUTDOWN = 246;

const MLRS_SYS_ID = 51;
const MLRS_COMP_ID = 68;
const MLRS_MAGIC_NUMBER = 1234321;

// Communication Settings
const PARAM_READ_TIMEOUT_MS = 500;
const PARAM_READ_RETRIES = 2;

// Registry of all known messages
const REGISTRY: any = {
    ...minimal.REGISTRY,
    ...common.REGISTRY,
};

// ------------------------------------
// MAVLink Connection Handler
// ------------------------------------

class MavLinkConnection {
    private port: SerialPort;
    private reader: ReadableStreamDefaultReader<Uint8Array> | null = null;
    private writer: WritableStreamDefaultWriter<Uint8Array> | null = null;

    // node-mavlink helpers
    private splitter = new MavLinkPacketSplitter();
    private parser = new MavLinkPacketParser();

    private onLog?: (msg: string) => void;

    // System ID for this GCS
    private mySysId = 255;
    private myCompId = 0; // 0 for GCS

    // Target (auto-detected from Heartbeat)
    public targetSysId = 1;
    public targetCompId = 1;

    private seq = 0;
    private readLoopActive = false;
    private readLoopPromise: Promise<void> | null = null;

    // Packet queue (like Python's approach) - all received packets go here
    private packetQueue: MavLinkPacket[] = [];

    constructor(port: SerialPort, onLog?: (msg: string) => void) {
        this.port = port;
        this.onLog = onLog;
    }

    async connect(baudRate: number) {
        try {
            await this.port.open({ baudRate });
        } catch (e: any) {
            // Port might already be open - check if it's usable
            if (!e?.message?.includes('already open')) {
                throw e;
            }
        }

        // Create fresh splitter/parser to avoid corrupted state from previous connections
        this.splitter = new MavLinkPacketSplitter();
        this.parser = new MavLinkPacketParser();
        this.packetQueue = [];

        // Wire up pipeline (must be done after creating fresh splitter/parser)
        this.initPipeline();

        if (this.port.readable && this.port.writable) {
            if (this.port.readable.locked) {
                throw new Error("Port readable stream is already locked!");
            }
            this.reader = this.port.readable.getReader();

            if (this.port.writable.locked) {
                 this.reader.releaseLock();
                 throw new Error("Port writable stream is already locked!");
            }
            this.writer = this.port.writable.getWriter();
            this.startReadLoop();
        } else {
            throw new Error("Failed to open port streams");
        }
    }

    async disconnect() {
        this.readLoopActive = false;

        // 1. Cancel Reader (unblocks reader.read())
        if (this.reader) {
            try {
                await this.reader.cancel();
            } catch { }
        }

        // 2. Wait for read loop to finish (with timeout)
        if (this.readLoopPromise) {
            try {
                await Promise.race([
                    this.readLoopPromise,
                    new Promise(r => setTimeout(r, 1000))
                ]);
            } catch { }
            this.readLoopPromise = null;
        }

        // 3. Release Locks
        if (this.reader) {
            try { this.reader.releaseLock(); } catch { }
            this.reader = null;
        }
        if (this.writer) {
            try { this.writer.releaseLock(); } catch { }
            this.writer = null;
        }

        // 4. Close Port
        if (this.port) {
            try {
                await this.port.close();
            } catch { }
        }
    }

    private startReadLoop() {
        if (this.readLoopActive) return;
        this.readLoopActive = true;

        if (!this.reader) return;

        this.readLoopPromise = (async () => {
            try {
                while (this.readLoopActive && this.reader) {
                    const { value, done } = await this.reader.read();
                    if (done) break;
                    if (value) {
                        this.splitter.write(value);
                    }
                }
            } catch {
                // Ignore errors on close/cancel
            } finally {
                this.readLoopActive = false;
            }
        })();
    }

    // Hook up pipeline
    initPipeline() {
        // wiring: splitter -> parser -> packetListeners
        this.splitter.on('data', (data: Uint8Array) => {
            this.parser.write(data);
        });

        this.parser.on('data', (packet: MavLinkPacket) => {
            // Deserialization: Convert raw bytes to typed objects
            const clazz = REGISTRY[packet.header.msgid];
            if (clazz && packet.protocol) {
                (packet as any).payload = packet.protocol.data(packet.payload, clazz);
            }

            // Push to queue (like Python's recv_match approach)
            this.packetQueue.push(packet);
        });
    }

    // New: Standard send using node-mavlink
    async send(msg: MavLinkData) {
        if (!this.writer) return;

        // Use MavLinkProtocolV2 to serialize
        const protocol = new MavLinkProtocolV2(this.mySysId, this.myCompId);
        const buffer = protocol.serialize(msg, this.seq);
        
        await this.writer.write(buffer);
        this.seq = (this.seq + 1) % 256;
    }

    // Poll packet queue for matching packet (like Python's mav_recv_match)
    async waitForPacket(msgId: number, timeoutMs = 2000, predicate?: (p: MavLinkPacket) => boolean): Promise<MavLinkPacket | null> {
        const startTime = Date.now();

        while (Date.now() - startTime < timeoutMs) {
            // Exit early if connection is dead
            if (!this.readLoopActive) return null;

            // Check queue for matching packet
            for (let i = 0; i < this.packetQueue.length; i++) {
                const packet = this.packetQueue[i];
                if (packet.header.msgid === msgId) {
                    if (predicate && !predicate(packet)) continue;

                    // Found it - remove from queue and return
                    this.packetQueue.splice(i, 1);
                    return packet;
                }
            }

            // Sleep 10ms then check again (like Python's time.sleep(0.01))
            await new Promise(r => setTimeout(r, 10));
        }

        return null;
    }

    // Helpers
    async waitForHeartbeat(timeoutMs = 10000): Promise<boolean> {
        this.onLog?.("wait for heartbeat...");
        const packet = await this.waitForPacket(0, timeoutMs); // 0 = HEARTBEAT
        if (packet) {
            const hb = packet.payload as any;
            this.onLog?.(`HEARTBEAT {type : ${hb.type}, autopilot : ${hb.autopilot}, base_mode : ${hb.baseMode}, custom_mode : ${hb.customMode}, system_status : ${hb.systemStatus}, mavlink_version : ${hb.mavlinkVersion}}`);

            if (hb.autopilot === MAV_AUTOPILOT_ARDUPILOTMEGA) {
                this.targetSysId = packet.header.sysid;
                this.targetCompId = packet.header.compid;
                return true;
            }
        }
        return false;
    }
    
    async paramRead(paramId: string, timeoutMs: number = PARAM_READ_TIMEOUT_MS, retries: number = PARAM_READ_RETRIES): Promise<number> {
        for (let attempt = 1; attempt <= retries + 1; attempt++) {
            const msg = new common.ParamRequestRead();
            msg.paramIndex = -1;
            msg.targetSystem = this.targetSysId;
            msg.targetComponent = this.targetCompId;
            msg.paramId = paramId;

            await this.send(msg);

            // Poll queue for PARAM_VALUE (like Python's mav_recv_match)
            const pkt = await this.waitForPacket(22, timeoutMs);
            if (pkt) {
                const payload = pkt.payload as any;
                return payload.paramValue;
            }

            // Timeout - retry if attempts remain
            if (attempt <= retries) {
                this.onLog?.(`paramRead '${paramId}' timeout, retrying (${attempt}/${retries})...`);
            }
        }

        throw new Error(`No response for ${paramId}`);
    }
    
    async paramSet(paramId: string, value: number) {
        const msg = new common.ParamSet();
        msg.paramValue = value;
        msg.targetSystem = this.targetSysId;
        msg.targetComponent = this.targetCompId;
        msg.paramId = paramId;
        // paramType is missing in some type definitions but required by ArduPilot
        (msg as any).paramType = 0;

        await this.send(msg);
        // Wait for confirmation (poll queue)
        await this.waitForPacket(22, 500); // 22 = PARAM_VALUE
    }

    // Poll for COMMAND_ACK with matching command and magic number
    async waitForMwAck(expectedCmd: number, magic: number, timeoutMs = 2000): Promise<boolean> {
        const pkt = await this.waitForPacket(77, timeoutMs, (packet) => {
            const payload = packet.payload as any;
            return payload?.command === expectedCmd && payload?.resultParam2 === magic;
        });
        return pkt !== null;
    }

    async commandLong(cmd: number, p1=0, p2=0, p3=0, p4=0, p5=0, p6=0, p7=0, targetSys?: number, targetComp?: number, confirmation=0) {
        const msg = new common.CommandLong();
        // Helper to set params to avoid excessive TS ignores
        const setParams = (m: any) => {
             m._param1 = p1; m._param2 = p2; m._param3 = p3; m._param4 = p4;
             m._param5 = p5; m._param6 = p6; m._param7 = p7;
        };
        setParams(msg);
        
        msg.command = cmd;
        msg.targetSystem = targetSys ?? this.targetSysId;
        msg.targetComponent = targetComp ?? this.targetCompId;
        msg.confirmation = confirmation;
        
        await this.send(msg);
    }
}

// ------------------------------------
// ArduPilot Passthrough Service (Port Scanning)
// ------------------------------------

export interface ArduPilotSerialPort {
    index: number;        // 1-8 (SERIAL number)
    name: string;         // "SERIAL2 (MAVLink2, 57600)"
    protocol: number;     // 1=MAVLink1, 2=MAVLink2, 28=Scripting
    baudRate: number;     // Actual baud rate
}

const FC_SETTLE_TIME_MS = 500;

// Baud rate lookup table (ArduPilot SERIAL_BAUD values)
const BAUD_LOOKUP: Record<number, number> = {
    1: 1200,
    2: 2400,
    4: 4800,
    9: 9600,
    19: 19200,
    38: 38400,
    57: 57600,
    111: 111100,
    115: 115200,
    230: 230400,
    256: 256000,
    460: 460800,
    500: 500000,
    921: 921600,
    1500: 1500000,
};

export class ArduPilotPassthroughService {
    private mav: MavLinkConnection;
    private onLog?: (msg: string) => void;

    constructor(port: SerialPort, onLog?: (msg: string) => void) {
        this.mav = new MavLinkConnection(port, onLog);
        this.onLog = onLog;
    }

    async connect(): Promise<boolean> {
        try {
            await this.mav.connect(57600);
            const got = await this.mav.waitForHeartbeat(5000);
            if (got) await new Promise(r => setTimeout(r, FC_SETTLE_TIME_MS)); // Let FC settle
            return got;
        } catch (e) {
            this.onLog?.(`ArduPilot connect error: ${e}`);
            return false;
        }
    }

    async disconnect(): Promise<void> {
        try {
            await this.mav.disconnect();
        } catch (e) {
            // Ignore disconnect errors
        }
    }

    async getMavLinkPorts(onProgress?: (msg: string) => void): Promise<ArduPilotSerialPort[]> {
        const result: ArduPilotSerialPort[] = [];

        // Scan SERIAL1 through SERIAL8
        for (let i = 1; i <= 8; i++) {
            onProgress?.(`Scanning SERIAL${i}...`);
            const protocolParam = `SERIAL${i}_PROTOCOL`;
            const baudParam = `SERIAL${i}_BAUD`;

            let protocol: number;
            try {
                // User Spec: Common timeout/retry for scanning
                protocol = await this.mav.paramRead(protocolParam, PARAM_READ_TIMEOUT_MS, PARAM_READ_RETRIES);
            } catch {
                continue;
            }

            // Filter to MAVLink-compatible protocols: 1=MAVLink1, 2=MAVLink2, 28=Scripting
            if (protocol !== 1 && protocol !== 2 && protocol !== 28) continue;

            let baudRate = 57600;
            try {
                const baudVal = await this.mav.paramRead(baudParam, PARAM_READ_TIMEOUT_MS, PARAM_READ_RETRIES);
                baudRate = BAUD_LOOKUP[baudVal] || baudVal * 1000;
            } catch { /* use default */ }

            let protocolName = 'MAVLink';
            if (protocol === 1) protocolName = 'MAVLink1';
            else if (protocol === 2) protocolName = 'MAVLink2';
            else if (protocol === 28) protocolName = 'Scripting';

            result.push({
                index: i,
                name: `SERIAL${i} (${protocolName}, ${baudRate})`,
                protocol,
                baudRate,
            });
        }

        return result;
    }
}

// ------------------------------------
// Public API
// ------------------------------------

export async function initArduPilotPassthrough(
    port: SerialPort,
    passthroughSerialStr: string, 
    isEsp: boolean,
    onLog?: (msg: string) => void
): Promise<{ port: SerialPort, baudRate: number }> {
    
    // Parse target SERIAL index
    const match = passthroughSerialStr.match(/SERIAL(\d+)/i);
    let serialIndex = 2; // default
    if (match) serialIndex = parseInt(match[1]);
    const pProtocolName = `SERIAL${serialIndex}_PROTOCOL`;

    // For ESP reconnection flow
    const info = port.getInfo();
    const targetVid = info.usbVendorId;
    const targetPid = info.usbProductId;

    onLog?.("------------------------------------------------------------");
    onLog?.(`ArduPilot Passthrough - ${passthroughSerialStr}`);
    onLog?.("------------------------------------------------------------");

    // Connect to the port (already verified by autoscan)
    let mav: MavLinkConnection | null = new MavLinkConnection(port, onLog);
    let activePort = port;

    try {
        await mav.connect(57600);

        if (!await mav.waitForHeartbeat(5000)) {
            throw new Error(
                "Connection failed: No MAVLink heartbeat detected.\n" +
                "Please ensure the Flight Controller is connected and powered."
            );
        }
        onLog?.("Heartbeat detected!");
        await new Promise(r => setTimeout(r, FC_SETTLE_TIME_MS)); // Let FC settle

        // ---------------------------------------------------------
        // 2. Initial Setup Checks
        // ---------------------------------------------------------
        
        // We have a live connection 'mav'. 
        // Perform parameter checks.
        
        const pBaudName = `SERIAL${serialIndex}_BAUD`;
        const protocol = await mav.paramRead(pProtocolName);
        const baudVal = await mav.paramRead(pBaudName);

        // Strict Mode validation
        if (protocol !== 2 && protocol !== 28) {
             throw new Error(`Invalid ${pProtocolName}=${protocol}. Must be 2 (MAVLink2) or 28 (Scripting).`);
        }

        // Baud Rate Check
        let receiverBaud = 57600;
        if (baudVal === 57) receiverBaud = 57600;
        else if (baudVal === 115) receiverBaud = 115200;
        else if (baudVal === 230) receiverBaud = 230400;
        else if (baudVal === 921) receiverBaud = 921600;
        else if (baudVal === 38) receiverBaud = 38400;

        if (receiverBaud !== 57600) {
            onLog?.(`Receiver baud is ${receiverBaud}. Switching link...`);
            await mav.disconnect();
            await new Promise(r => setTimeout(r, 500));
            await mav.connect(receiverBaud);
            // Quick verify
            if (!await mav.waitForHeartbeat(5000)) {
                 throw new Error(`Failed to reconnect at ${receiverBaud}.`);
            }
            await new Promise(r => setTimeout(r, FC_SETTLE_TIME_MS)); // Let FC settle
        }

        // ---------------------------------------------------------
        // 3. ESP Workflow
        // ---------------------------------------------------------
        if (isEsp) {
            // Assume we always need to force bootloader mode for ESP
            if (protocol !== 28) {
                 onLog?.(`ESP: Setting ${pProtocolName} -> 28 (Scripting)...`);
                 try { await mav.paramSet(pProtocolName, 28); } catch(e) {}
                 
                 onLog?.("---------------------------------------------------");
                 onLog?.("1. Power down the flight controller.");
                 onLog?.("2. Hold down the receiver BOOT button.");
                 onLog?.("3. Power up the flight controller and plug in USB.");
                 onLog?.("   You have 60 seconds to reconnect.");
                 onLog?.("---------------------------------------------------");

                 await mav.disconnect();

                 onLog?.("Please disconnect the flight controller within 60 seconds...");
                 // Wait for physical unplug (with 60s timeout)
                 const disconnectStart = Date.now();
                 let disconnected = false;
                 while (Date.now() - disconnectStart < 60000) {
                     try {
                         await activePort.open({ baudRate: 57600 });
                         await activePort.close();
                         // If open worked, device is still here.
                         await new Promise(r => setTimeout(r, 500));
                     } catch (e) {
                         onLog?.("Flight controller disconnected.");
                         disconnected = true;
                         break;
                     }
                 }

                 if (!disconnected) {
                     throw new Error("Timed out waiting for flight controller disconnect.");
                 }

                 onLog?.("Scanning for Reconnection (Active)...");

                 let reconnectedMav: MavLinkConnection | null = null;
                 let reconnectedPort: any = null;
                 const startTime = Date.now();

                 // 60s Reconnect Loop
                 while (Date.now() - startTime < 60000) {
                     // Refresh candidates
                     const allPorts = await (navigator.serial as any).getPorts();
                     const freshCandidates = allPorts.filter((p: any) => {
                         const i = p.getInfo();
                         return i.usbVendorId === targetVid && i.usbProductId === targetPid;
                     });
                     
                     for (let i=0; i<freshCandidates.length; i++) {
                         const p = freshCandidates[i];
                         const m = new MavLinkConnection(p, onLog);
                         try {
                             await m.connect(57600);
                             // Quick check 2s
                             if (await m.waitForHeartbeat(2000)) {
                                 onLog?.(`[Candidate ${i+1}] Reconnected & Active!`);
                                 reconnectedMav = m;
                                 reconnectedPort = p;
                                 break;
                             }
                             await m.disconnect();
                         } catch(e) {
                            await m.disconnect().catch(() => {});
                        }
                     }
                     if (reconnectedMav) break;
                     await new Promise(r => setTimeout(r, 500));
                 }
                 
                 if (!reconnectedMav) throw new Error("Timed out waiting for flight controller reconnection.");
                 
                 mav = reconnectedMav;
                 activePort = reconnectedPort;
                 
                 // Restore Passthrough
                 onLog?.("Restoring Passthrough...");
                 await new Promise(r => setTimeout(r, 500)); // Boot settle
                 await mav.paramSet(pProtocolName, 2);
                 await mav.paramSet("SERIAL_PASSTIMO", 0);
                 await mav.paramSet("SERIAL_PASS2", serialIndex);
                 await new Promise(r => setTimeout(r, 500));
            } else {
                 // Already in 28. Ensure passthrough.
                 onLog?.("ESP in Scripting Mode. Resetting to Passthrough...");
                 await mav.paramSet(pProtocolName, 2);
                 await mav.paramSet("SERIAL_PASSTIMO", 0);
                 await mav.paramSet("SERIAL_PASS2", serialIndex);
                 await new Promise(r => setTimeout(r, 500));
            }
            
            onLog?.("ESP Ready for Flashing.");
            // mav will be disconnected in finally
            await new Promise(r => setTimeout(r, 500));
            return { port: activePort, baudRate: receiverBaud };
            
        } else {
            // STM32
            onLog?.("Activating Passthrough...");
            await mav.paramSet(pProtocolName, 2);
            await mav.paramSet("SERIAL_PASSTIMO", 0);
            await mav.paramSet("SERIAL_PASS2", serialIndex);
            await new Promise(r => setTimeout(r, 500));
        }

        // ---------------------------------------------------------
        // Post-Setup (Bootloader Trigger) - mlrs_put_into_systemboot
        // ---------------------------------------------------------
 

        onLog?.("check connection to mLRS receiver...");
        // Step 1: Probe/Ping (Conf=0, Action=0)
        let ack = false;
        // Try 3 times (reduced from 5 to save time if ACKs are missing)
        for (let i = 0; i < 3; i++) {
             const ackPromise = mav.waitForMwAck(MAV_CMD_PREFLIGHT_REBOOT_SHUTDOWN, MLRS_MAGIC_NUMBER, 500);
             await mav.commandLong(MAV_CMD_PREFLIGHT_REBOOT_SHUTDOWN, 0, 0, 0, MLRS_COMP_ID, 0, 0, MLRS_MAGIC_NUMBER, MLRS_SYS_ID, MLRS_COMP_ID, 0);
             if (await ackPromise) {
                 ack = true;
                 break;
             }
             onLog?.(`  Probe retry ${i+1}...`); 
        }
        if (!ack) {
             onLog?.("No response to probe. Attempting to proceed...");
        } else {
             onLog?.("mLRS receiver connected");
        }

        // Step 2: Arm (Conf=1, Action=3)
        onLog?.("arm mLRS receiver for reboot shutdown...");
        ack = false;
        for (let i = 0; i < 3; i++) {
             const ackPromise = mav.waitForMwAck(MAV_CMD_PREFLIGHT_REBOOT_SHUTDOWN, MLRS_MAGIC_NUMBER, 500);
             await mav.commandLong(MAV_CMD_PREFLIGHT_REBOOT_SHUTDOWN, 1, 0, 3, MLRS_COMP_ID, 0, 0, MLRS_MAGIC_NUMBER, MLRS_SYS_ID, MLRS_COMP_ID, 1);
             if (await ackPromise) {
                 ack = true;
                 break;
             }
             // onLog?.("Retry Arm..."); 
        }
        if (!ack) onLog?.("No response to arm command. Proceeding...");
        else onLog?.("mLRS receiver armed for reboot shutdown");

        // Step 3: Execute (Conf=2, Action=3)
        onLog?.("mLRS receiver reboot shutdown...");
        await mav.commandLong(MAV_CMD_PREFLIGHT_REBOOT_SHUTDOWN, 2, 0, 3, MLRS_COMP_ID, 0, 0, MLRS_MAGIC_NUMBER, MLRS_SYS_ID, MLRS_COMP_ID, 2);
        
        onLog?.("mLRS receiver reboot shutdown DONE");
        onLog?.("mLRS receiver jumps to system bootloader in 2 seconds");

        // wait for reboot
        await new Promise(r => setTimeout(r, REBOOT_WAIT_MS));

        onLog?.("PASSTHROUGH READY FOR PROGRAMMING TOOL");
        return { port: activePort, baudRate: receiverBaud };

    } finally {
        if (mav) {
            await mav.disconnect();
        }
    }
}
