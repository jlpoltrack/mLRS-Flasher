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
    
    // Parse target SERIAL index
    const match = passthroughSerialStr.match(/SERIAL(\d+)/i);
    let serialIndex = 2; // default
    if (match) serialIndex = parseInt(match[1]);
    const pProtocolName = `SERIAL${serialIndex}_PROTOCOL`;

    // 1. Identify Target Device Type
    const info = port.getInfo();
    const targetVid = info.usbVendorId;
    const targetPid = info.usbProductId;

    onLog?.("------------------------------------------------------------");
    onLog?.(`AP Passthru (Strict MAVLink 2.0) - ${passthroughSerialStr}`);
    onLog?.("------------------------------------------------------------");
    
    let mav: MavLinkConnection | null = null;
    let activePort = port;

    // ---------------------------------------------------------
    // 1. Establish Active Connection (Scan Mode)
    // ---------------------------------------------------------
    
    // Logic: Identify all candidate ports. Try each one.
    // If we find a heartbeat, lock it.
    
    // @ts-ignore
    const candidates = (await navigator.serial.getPorts()).filter((p: any) => {
         const i = p.getInfo();
         return i.usbVendorId === targetVid && i.usbProductId === targetPid;
    });

    if (candidates.length === 0) candidates.push(port); // Fallback

    onLog?.(`Found ${candidates.length} matching port(s). Scanning for heartbeat...`);

    let foundInitial = false;
    for (let i = 0; i < candidates.length; i++) {
        const p = candidates[i];
        
        onLog?.(`[Candidate ${i+1}/${candidates.length}] Probe Connecting...`);
        
        const m = new MavLinkConnection(p, onLog);
        try {
            await m.connect(57600);
            m.initPipeline(); 
            
            // Wait up to 5s for heartbeat (User Request)
            if (await m.waitForHeartbeat(5000)) {
                onLog?.(`[Candidate ${i+1}] Heartbeat detected! Active Device Found.`);
                mav = m;
                activePort = p;
                foundInitial = true;
                break;
            } else {
                onLog?.(`[Candidate ${i+1}] No heartbeat (5s). Disconnecting...`);
                await m.disconnect();
            }
        } catch (e) {
            onLog?.(`[Candidate ${i+1}] Error: ${e}`);
            try { await m.disconnect(); } catch (err) {} 
        }
    }

    if (!foundInitial || !mav) {
        throw new Error("Connection failed: No MAVLink heartbeat detected on any candidate port (10s window).");
    }

    // ---------------------------------------------------------
    // 2. Initial Setup Checks
    // ---------------------------------------------------------
    
    // We have a live connection 'mav'. 
    // Perform parameter checks.
    
    const pBaudName = `SERIAL${serialIndex}_BAUD`;
    // onLog?.(`Reading Link Parameters...`);
    const protocol = await mav.paramRead(pProtocolName);
    const baudVal = await mav.paramRead(pBaudName);
    
    if (protocol === null || baudVal === null) throw new Error("Failed to read SERIAL parameters.");

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
             await mav.disconnect();
             throw new Error(`Failed to reconnect at ${receiverBaud}.`);
        }
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

             onLog?.("Waiting for device disconnect...");
             // Wait for physical unplug
             while (true) {
                 try {
                     await activePort.open({ baudRate: 57600 });
                     await activePort.close();
                     // If open worked, device is still here.
                     await new Promise(r => setTimeout(r, 500));
                 } catch (e) {
                     onLog?.("Device disconnected.");
                     break;
                 }
             }

             onLog?.("Scanning for Reconnection (Active)...");

             let reconnectedMav: MavLinkConnection | null = null;
             let reconnectedPort: any = null;
             const startTime = Date.now();

             // 60s Reconnect Loop
             while (Date.now() - startTime < 60000) {
                 // Refresh candidates
                 // @ts-ignore
                 const freshCandidates = (await navigator.serial.getPorts()).filter((p: any) => {
                     const i = p.getInfo();
                     return i.usbVendorId === targetVid && i.usbProductId === targetPid;
                 });
                 
                 for (let i=0; i<freshCandidates.length; i++) {
                     const p = freshCandidates[i];
                     const m = new MavLinkConnection(p, onLog);
                     try {
                         await m.connect(57600);
                         m.initPipeline();
                         // Quick check 2s
                         if (await m.waitForHeartbeat(2000)) {
                             onLog?.(`[Candidate ${i+1}] Reconnected & Active!`);
                             reconnectedMav = m;
                             reconnectedPort = p;
                             break;
                         }
                         await m.disconnect();
                     } catch(e) {}
                 }
                 if (reconnectedMav) break;
                 await new Promise(r => setTimeout(r, 1000));
             }
             
             if (!reconnectedMav) throw new Error("Timed out waiting for device reconnection.");
             
             mav = reconnectedMav;
             activePort = reconnectedPort;
             
             // Restore Passthrough
             onLog?.("Restoring Passthrough...");
             await new Promise(r => setTimeout(r, 1000)); // Boot settle
             await mav.paramSet(pProtocolName, 2);
             await mav.paramSet("SERIAL_PASSTIMO", 0);
             await mav.paramSet("SERIAL_PASS2", serialIndex);
             await new Promise(r => setTimeout(r, 1500));
        } else {
             // Already in 28. Ensure passthrough.
             onLog?.("ESP in Scripting Mode. Resetting to Passthrough...");
             await mav.paramSet(pProtocolName, 2);
             await mav.paramSet("SERIAL_PASSTIMO", 0);
             await mav.paramSet("SERIAL_PASS2", serialIndex);
             await new Promise(r => setTimeout(r, 1500));
        }
        
        onLog?.("ESP Ready for Flashing.");
        await mav?.disconnect();
        await new Promise(r => setTimeout(r, 500));
        return { port: activePort, baudRate: receiverBaud };
        
    } else {
        // STM32
        onLog?.("Activating Passthrough...");
        await mav.paramSet(pProtocolName, 2);
        await mav.paramSet("SERIAL_PASSTIMO", 0);
        await mav.paramSet("SERIAL_PASS2", serialIndex);
        await new Promise(r => setTimeout(r, 1500));
    }

    try {
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
        return { port: activePort, baudRate: receiverBaud };
        
    } finally {
        await mav.disconnect();
    }
}
