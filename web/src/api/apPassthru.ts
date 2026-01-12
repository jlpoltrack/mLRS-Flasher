// @ts-ignore
import { MavLinkPacketSplitter, MavLinkPacketParser, MavLinkData, MavLinkPacket, minimal, common } from 'node-mavlink';

// ------------------------------------
// Message Definitions (Minimal)
// ------------------------------------

// We define minimal classes to avoid large dependencies if 'mavlink-mappings' isn't reliable.
// However, since we are using node-mavlink, we should extend MavLinkData.



// ------------------------------------
// Constants
// ------------------------------------
const MAV_AUTOPILOT_ARDUPILOTMEGA = 3;
const MAV_CMD_PREFLIGHT_REBOOT_SHUTDOWN = 246;

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

    // Event bus for packets
    private packetListeners: ((packet: MavLinkPacket) => void)[] = [];

    constructor(port: SerialPort, onLog?: (msg: string) => void) {
        this.port = port;
        this.onLog = onLog;
    }

    async connect(baudRate: number) {
        try {
            await this.port.open({ baudRate });
        } catch (e) {
            // Check if open
        }
        
        if (this.port.readable && this.port.writable) {
            this.reader = this.port.readable.getReader();
            this.writer = this.port.writable.getWriter();
            this.startReadLoop();
        } else {
            throw new Error("Failed to open port streams");
        }
    }

    async disconnect() {
        this.readLoopActive = false;
        try {
            await this.reader?.cancel();
            this.reader?.releaseLock();
            this.writer?.releaseLock();
            await this.port.close();
        } catch (e) {
             console.error(e);
        }
    }

    private async startReadLoop() {
        if (this.readLoopActive) return;
        this.readLoopActive = true;

        if (!this.reader) return;

        try {
            while (this.readLoopActive) {
                const { value, done } = await this.reader.read();
                if (done) break;
                if (value) {
                     // this.onLog?.(`[RAW] Read ${value.length} bytes`);
                     // Feed splitter
                     this.splitter.write(value);
                }
            }
        } catch (e) {
            console.error("Read loop error", e);
        }
    }

    // Hook up pipeline
    initPipeline() {
        // wiring: splitter -> parser -> packetListeners
        this.splitter.on('data', (data: Uint8Array) => {
            // this.onLog?.(`[SPLITTER] Found packet chunk len=${data.length}`);
            this.parser.write(data);
        });

        this.parser.on('data', (packet: MavLinkPacket) => {
            // this.onLog?.(`[PARSER] Packet MsgID=${packet.header.msgid} SysID=${packet.header.sysid}`);
            // Dispatch
            for (const listener of this.packetListeners) {
                listener(packet);
            }
        });
    }

    // Manual Packet Construction (since we don't have full generated classes)
    // We will construct MavLinkPacket directly
    async sendRawPacket(msgId: number, payload: Uint8Array, crcExtra: number) {
        if (!this.writer) return;
        
        const header = new Uint8Array(10);
        const len = payload.length;
        
        header[0] = 0xFD; // STX v2
        header[1] = len;
        header[2] = 0; // incompat
        header[3] = 0; // compat
        header[4] = this.seq;
        header[5] = this.mySysId;
        header[6] = this.myCompId;
        header[7] = msgId & 0xFF;
        header[8] = (msgId >> 8) & 0xFF;
        header[9] = (msgId >> 16) & 0xFF;

        // Start CRC (X.25)
        let crc = 0xffff;
        const crcAccumulate = (data: number) => {
             let tmp = data ^ (crc & 0xff);
             tmp ^= (tmp << 4) & 0xff;
             crc = (crc >> 8) ^ (tmp << 8) ^ (tmp << 3) ^ (tmp >> 4);
        };
        
        // CRC over header (excluding STX) + payload
        for (let i = 1; i < 10; i++) crcAccumulate(header[i]);
        for (let i = 0; i < len; i++) crcAccumulate(payload[i]);
        crcAccumulate(crcExtra);

        const fullPacket = new Uint8Array(10 + len + 2);
        fullPacket.set(header, 0);
        fullPacket.set(payload, 10);
        fullPacket.set([crc & 0xFF, (crc >> 8) & 0xFF], 10 + len);

        await this.writer.write(fullPacket);
        this.seq = (this.seq + 1) % 256;
    }

    async waitForPacket(msgId: number, timeoutMs = 2000): Promise<MavLinkPacket | null> {
        return new Promise<MavLinkPacket | null>((resolve) => {
            let timeout: any;
            const listener = (packet: MavLinkPacket) => {
                 if (packet.header.msgid === msgId) {
                     clearTimeout(timeout);
                     // Remove listener
                     this.packetListeners = this.packetListeners.filter(l => l !== listener);
                     resolve(packet);
                 }
            };
            
            this.packetListeners.push(listener);
            
            timeout = setTimeout(() => {
                this.packetListeners = this.packetListeners.filter(l => l !== listener);
                resolve(null);
            }, timeoutMs);
        });
    }

    // Helpers
    async waitForHeartbeat(timeoutMs = 10000): Promise<boolean> {
        this.onLog?.("wait for heartbeat...");
        // We accept any heartbeat, but check if it's ArduPilot
        const packet = await this.waitForPacket(0, timeoutMs);
        if (packet) {
            // Interpret payload manually
            // custom_mode(4), type(1), autopilot(1), base_mode(1), system_status(1), mavlink_version(1)
            const data = packet.payload;
            const custom_mode = new DataView(data.buffer, data.byteOffset).getUint32(0, true);
            const type = data[4];
            const autopilot = data[5];
            const base_mode = data[6];
            const system_status = data[7];
            const mavlink_version = data[8];
            
            this.onLog?.(`HEARTBEAT {type : ${type}, autopilot : ${autopilot}, base_mode : ${base_mode}, custom_mode : ${custom_mode}, system_status : ${system_status}, mavlink_version : ${mavlink_version}}`);
            
            if (autopilot === MAV_AUTOPILOT_ARDUPILOTMEGA) {
                this.targetSysId = packet.header.sysid;
                this.targetCompId = packet.header.compid;
                return true;
            }
        }
        return false;
    }
    
    async paramRead(paramId: string): Promise<number | null> {
        // Request
        // target_system, target_component, param_id(16), param_index(2)
        const payload = new Uint8Array(20);
        const view = new DataView(payload.buffer);
        view.setInt16(0, -1, true); // index
        payload[2] = this.targetSysId;
        payload[3] = this.targetCompId;
        const enc = new TextEncoder();
        payload.set(enc.encode(paramId).slice(0, 16), 4);
        
        await this.sendRawPacket(20, payload, 214); // Msg 20, CRC 214
        
        // Wait response
        const start = Date.now();
        while (Date.now() - start < 1500) {
            const pkt = await this.waitForPacket(22, 500);
            if (pkt) {
                // val(4), count(2), index(2), id(16), type(1)
                const data = pkt.payload;
                const idBytes = data.subarray(8, 24); // 4+2+2=8
                let nullIdx = idBytes.indexOf(0);
                if (nullIdx === -1) nullIdx = 16;
                const recId = new TextDecoder().decode(idBytes.subarray(0, nullIdx));
                
                if (recId === paramId) {
                    return new DataView(data.buffer, data.byteOffset).getFloat32(0, true);
                }
            }
        }
        return null;
    }
    
    async paramSet(paramId: string, value: number) {
        // param_value(4), target_system, target_component, param_id(16), param_type(1)
        const payload = new Uint8Array(23);
        const view = new DataView(payload.buffer);
        view.setFloat32(0, value, true);
        payload[4] = this.targetSysId;
        payload[5] = this.targetCompId;
        payload.set(new TextEncoder().encode(paramId).slice(0, 16), 6);
        payload[22] = 0; // type
        
        await this.sendRawPacket(23, payload, 168); // Msg 23, CRC 168
        await this.waitForPacket(22, 500); // Wait for value confirmation
    }
    
    async waitForMwAck(expectedCmd: number, magic: number, timeoutMs = 2000): Promise<boolean> {
        return new Promise<boolean>((resolve) => {
            let timeout: any;
            const listener = (packet: MavLinkPacket) => {
                 if (packet.header.msgid === 77) { // COMMAND_ACK
                     const data = packet.payload;
                     // command(2), result(1), progress(1), result_param2(4), target_sys(1), target_comp(1)
                     const cmd = new DataView(data.buffer, data.byteOffset).getUint16(0, true);
                     const resP2 = new DataView(data.buffer, data.byteOffset).getInt32(4, true);
                     
                     if (cmd === expectedCmd && resP2 === magic) {
                         clearTimeout(timeout);
                         this.packetListeners = this.packetListeners.filter(l => l !== listener);
                         resolve(true);
                     }
                 }
            };
            
            this.packetListeners.push(listener);
            
            timeout = setTimeout(() => {
                this.packetListeners = this.packetListeners.filter(l => l !== listener);
                resolve(false);
            }, timeoutMs);
        });
    }

    async commandLong(cmd: number, p1=0, p2=0, p3=0, p4=0, p5=0, p6=0, p7=0, targetSys?: number, targetComp?: number, confirmation=0) {
        // param1..7 (4*7=28), command(2), target_sys(1), target_comp(1), confirmation(1) -> 33 bytes
        const payload = new Uint8Array(33);
        const view = new DataView(payload.buffer);
        view.setFloat32(0, p1, true);
        view.setFloat32(4, p2, true);
        view.setFloat32(8, p3, true);
        view.setFloat32(12, p4, true);
        view.setFloat32(16, p5, true);
        view.setFloat32(20, p6, true);
        view.setFloat32(24, p7, true);
        view.setUint16(28, cmd, true);
        payload[30] = targetSys ?? this.targetSysId;
        payload[31] = targetComp ?? this.targetCompId;
        payload[32] = confirmation;
        
        await this.sendRawPacket(76, payload, 152); // Msg 76, CRC 152
    }
}

// ------------------------------------
// Public API
// ------------------------------------

export async function initApPassthrough(
    port: SerialPort,
    passthroughSerialStr: string, 
    isEsp: boolean,
    onLog?: (msg: string) => void
): Promise<{ port: SerialPort, baudRate: number }> {
    
    const match = passthroughSerialStr.match(/SERIAL(\d+)/i);
    let serialIndex = 2; // default
    if (match) serialIndex = parseInt(match[1]);

    const mav = new MavLinkConnection(port, onLog);
    mav.initPipeline();

    onLog?.("------------------------------------------------------------");
    onLog?.("Find USB port of your flight controller");
    onLog?.("USB port: Selected Port"); 
    onLog?.("Baud rate: 57600");
    onLog?.(`SERIALx number: ${serialIndex}`);
    onLog?.("------------------------------------------------------------");

    // ---------------------------------------------------------
    // 1. ardupilot_connect
    // ---------------------------------------------------------
    onLog?.("connect to flight controller...");
    
    // We try 57600 as per Python default
    await mav.connect(57600);
    
    // 1st Heartbeat (10s timeout)
    if (!await mav.waitForHeartbeat(10000)) {
        await mav.disconnect();
        throw new Error("No Heartbeat received from FC (10s timeout).");
    }

    // Set target system/comp from first heartbeat is handled in waitForHeartbeat
    
    // 2nd Heartbeat (2.5s timeout) - strict Python logic
    if (!await mav.waitForHeartbeat(2500)) {
        await mav.disconnect();
        throw new Error("Second Heartbeat verification failed.");
    }

    onLog?.(`received (sysid ${mav.targetSysId} compid ${mav.targetCompId})`);
    onLog?.("connected to flight controller");
    onLog?.("------------------------------------------------------------");

    try {
        // ---------------------------------------------------------
        // 2. ardupilot_find_serialx_baud
        // ---------------------------------------------------------
        onLog?.("find SERIALx, receiver baud rate...");
        const pProtocolName = `SERIAL${serialIndex}_PROTOCOL`;
        const pBaudName = `SERIAL${serialIndex}_BAUD`;

        // onLog?.(`Reading ${pProtocolName}...`); 
        const protocol = await mav.paramRead(pProtocolName);
        if (protocol === null) throw new Error(`Failed to read ${pProtocolName}`);
        
        // Strict check: must be 2.0 or 28.0
        if (protocol !== 2 && protocol !== 28) {
            throw new Error(`Invalid ${pProtocolName}=${protocol}. Must be 2 (MAVLink2) or 28 (Scripting). Please check Mission Planner.`);
        }

        // onLog?.(`Reading ${pBaudName}...`);
        const baudVal = await mav.paramRead(pBaudName);
        if (baudVal === null) throw new Error(`Failed to read ${pBaudName}`);

        let receiverBaud = 57600;
        if (baudVal === 57) receiverBaud = 57600;
        else if (baudVal === 115) receiverBaud = 115200;
        else if (baudVal === 230) receiverBaud = 230400;
        else if (baudVal === 921) receiverBaud = 921600;
        else if (baudVal === 38) receiverBaud = 38400;
        
        // onLog?.(`Receiver Baud: ${receiverBaud}`);

        if (receiverBaud !== 57600) {
            // "Receiver baudrate is 230400 , change link to it"
            onLog?.(`Receiver baudrate is ${receiverBaud} , change link to it`);
            await mav.disconnect();
            await new Promise(r => setTimeout(r, 500));
            onLog?.("connect to flight controller...");
            await mav.connect(receiverBaud);

            // onLog?.("Waiting for Heartbeat 1 (after baud change)...");
            if (!await mav.waitForHeartbeat(10000)) {
                 await mav.disconnect();
                 throw new Error(`Failed to reconnect at ${receiverBaud} baud.`);
            }

            // onLog?.("Waiting for Heartbeat 2 (after baud change)...");
            if (!await mav.waitForHeartbeat(2500)) {
                 await mav.disconnect();
                 throw new Error("Second Heartbeat verification failed after baud change.");
            }
        } 

        // ---------------------------------------------------------
        // 3. Scripting / ESP Handling
        // (Mimics ardupilot_set_scripting logic if needed)
        // ---------------------------------------------------------
        if (isEsp) {
            // If we are here, protocol is 2 or 28 (checked above).
            // If it is NOT 28, we must set it and ask for reboot.
            if (protocol !== 28) {
                 onLog?.(`ESP Mode: Setting ${pProtocolName} to Scripting (28)...`);
                 await mav.paramSet(pProtocolName, 28);
                 // In Python: link.close() and do_msg(Power down...)
                 throw new Error("Setup: Scripting Mode (28) enabled. Please POWER CYCLE the Flight Controller, then try again.");
            }
            // If it IS 28, we proceed. 
            // Note: Python's open_passthrough sets Protocol=2 below. 
            // This is correct behavior for ESP flashing (set 28, reboot, then set 2 & passthrough).
        }

        // ---------------------------------------------------------
        // 4. ardupilot_open_passthrough
        // ---------------------------------------------------------
        onLog?.("open serial passthrough...");

        // "restore protocol to MAVLink2 in case it was changed to scripting"
        // onLog?.(`Setting ${pProtocolName} = 2 (MAVLink2)`);
        await mav.paramSet(pProtocolName, 2);

        // onLog?.("Setting SERIAL_PASSTIMO = 0");
        await mav.paramSet("SERIAL_PASSTIMO", 0);

        // onLog?.(`Setting SERIAL_PASS2 = ${serialIndex}`);
        await mav.paramSet("SERIAL_PASS2", serialIndex);

        // onLog?.("Waiting 1.5s for passthrough activation...");
        await new Promise(r => setTimeout(r, 1500)); 

        // ---------------------------------------------------------
        // Post-Setup (Bootloader Trigger) - mlrs_put_into_systemboot
        // ---------------------------------------------------------
        const mLRS_SysID = 51;
        const mLRS_CompID = 68;
        const magic = 1234321; 

        onLog?.("check connection to mLRS receiver...");
        // Step 1: Probe/Ping (Conf=0, Action=0)
        let ack = false;
        for (let i = 0; i < 5; i++) {
             await mav.commandLong(MAV_CMD_PREFLIGHT_REBOOT_SHUTDOWN, 0, 0, 0, mLRS_CompID, 0, 0, magic, mLRS_SysID, mLRS_CompID, 0);
             if (await mav.waitForMwAck(MAV_CMD_PREFLIGHT_REBOOT_SHUTDOWN, magic, 500)) {
                 ack = true;
                 break;
             }
             onLog?.("  send probe"); 
        }
        if (!ack) {
             onLog?.("Sorry, something went wrong.");
        } else {
             onLog?.("mLRS receiver connected");
        }

        // Step 2: Arm (Conf=1, Action=3)
        onLog?.("arm mLRS receiver for reboot shutdown...");
        ack = false;
        for (let i = 0; i < 3; i++) {
             await mav.commandLong(MAV_CMD_PREFLIGHT_REBOOT_SHUTDOWN, 1, 0, 3, mLRS_CompID, 0, 0, magic, mLRS_SysID, mLRS_CompID, 1);
             if (await mav.waitForMwAck(MAV_CMD_PREFLIGHT_REBOOT_SHUTDOWN, magic, 500)) {
                 ack = true;
                 break;
             }
             // onLog?.("Retry Arm..."); // Python doesn't seem to retry arm in logs or uses "send probe" text? 
        }
        if (!ack) onLog?.("Sorry, something went wrong.");
        else onLog?.("mLRS receiver armed for reboot shutdown");

        // Step 3: Execute (Conf=2, Action=3)
        onLog?.("mLRS receiver reboot shutdown...");
        await mav.commandLong(MAV_CMD_PREFLIGHT_REBOOT_SHUTDOWN, 2, 0, 3, mLRS_CompID, 0, 0, magic, mLRS_SysID, mLRS_CompID, 2);
        
        onLog?.("mLRS receiver reboot shutdown DONE");
        onLog?.("mLRS receiver jumps to system bootloader in 5 seconds");

        // Wait minor delay for reboot
        await new Promise(r => setTimeout(r, 200));

        onLog?.("PASSTHROUGH READY FOR PROGRAMMING TOOL");
        return { port, baudRate: receiverBaud };
        
    } finally {
        await mav.disconnect();
    }
}
