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
            if (this.port.readable.locked) {
                // If locked, we try to wait a moment or just fail gracefully 
                // But generally this implies previous cleanup failed.
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
        try {
            if (this.reader) {
                try {
                    await this.reader.cancel();
                } catch (e) {
                    console.warn("Reader cancel warning:", e);
                }
                this.reader.releaseLock();
                this.reader = null;
            }
            if (this.writer) {
                this.writer.releaseLock();
                this.writer = null;
            }
            await this.port.close();
        } catch (e) {
             console.error("Disconnect error:", e);
        }
    }

    private async startReadLoop() {
        if (this.readLoopActive) return;
        this.readLoopActive = true;

        if (!this.reader) return;

        try {
            while (this.readLoopActive && this.reader) {
                const { value, done } = await this.reader.read();
                if (done) break;
                if (value) {
                     // this.onLog?.(`[RAW] Read ${value.length} bytes`);
                     // Feed splitter
                     this.splitter.write(value);
                }
            }
        } catch (e) {
            // Ignore errors on close/cancel
            // console.error("Read loop error", e);
        } finally {
            this.readLoopActive = false;
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
            // Deserialization: Convert raw bytes to typed objects
            const clazz = REGISTRY[packet.header.msgid];
            if (clazz && packet.protocol) {
                (packet as any).payload = packet.protocol.data(packet.payload, clazz);
            }

            // Dispatch
            for (const listener of this.packetListeners) {
                listener(packet);
            }
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
        const packet = await this.waitForPacket(0, timeoutMs); // 0 = HEARTBEAT
        if (packet) {
            if (packet.payload instanceof minimal.Heartbeat) {
                 const hb = packet.payload as minimal.Heartbeat;
                 this.onLog?.(`HEARTBEAT {type : ${hb.type}, autopilot : ${hb.autopilot}, base_mode : ${hb.baseMode}, custom_mode : ${hb.customMode}, system_status : ${hb.systemStatus}, mavlink_version : ${hb.mavlinkVersion}}`);
                 
                 if (hb.autopilot === MAV_AUTOPILOT_ARDUPILOTMEGA) {
                    this.targetSysId = packet.header.sysid;
                    this.targetCompId = packet.header.compid;
                    return true;
                 }
            }
        }
        return false;
    }
    
    async paramRead(paramId: string): Promise<number | null> {
        const msg = new common.ParamRequestRead();
        msg.paramIndex = -1;
        msg.targetSystem = this.targetSysId;
        msg.targetComponent = this.targetCompId;
        msg.paramId = paramId; 
        
        await this.send(msg);
        
        // Wait response
        const start = Date.now();
        while (Date.now() - start < 1500) {
            const pkt = await this.waitForPacket(22, 500); // PARAM_VALUE
            if (pkt) {
                if (pkt.payload instanceof common.ParamValue) {
                    const val = pkt.payload as common.ParamValue;
                    if (val.paramId.replace(/\0/g, '') === paramId) {
                        return val.paramValue;
                    }
                }
            }
        }
        return null;
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
        await this.waitForPacket(22, 500); // Wait for value confirmation
    }
    
    async waitForMwAck(expectedCmd: number, magic: number, timeoutMs = 2000): Promise<boolean> {
        return new Promise<boolean>((resolve) => {
            let timeout: any;
            const listener = (packet: MavLinkPacket) => {
                 if (packet.header.msgid === 77) { // COMMAND_ACK
                     let cmd = 0;
                     let resP2 = 0;
                     
                     if (packet.payload instanceof common.CommandAck) {
                         const ack = packet.payload as common.CommandAck;
                         cmd = ack.command;
                         resP2 = ack.resultParam2;
                     }

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
    onLog?.(`AP Passthru - ${passthroughSerialStr}`);
    onLog?.("------------------------------------------------------------");
    
    let mav: MavLinkConnection | null = null;
    let activePort = port;

    // ---------------------------------------------------------
    // 1. Establish Active Connection (Scan Mode)
    // ---------------------------------------------------------
    
    // Logic: Identify all candidate ports. Try each one.
    // If we find a heartbeat, lock it.
    
    const allPorts = await (navigator.serial as any).getPorts();
    const candidates = allPorts.filter((p: any) => {
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
        throw new Error(
            "Connection failed: No MAVLink heartbeat detected on any candidate port (10s window).\n" +
            "Please ensure:\n" +
            "1. The Flight Controller is connected via USB.\n" +
            "2. You have selected the correct COM port (check Device Manager/System Report).\n" +
            "3. If using a different port instance (e.g. Composite device), try clicking 'Add Device' again to re-authorize the correct interface."
        );
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
                 await new Promise(r => setTimeout(r, 500));
             }
             
             if (!reconnectedMav) throw new Error("Timed out waiting for device reconnection.");
             
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
        await mav?.disconnect();
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

    try {
        // ---------------------------------------------------------
        // Post-Setup (Bootloader Trigger) - mlrs_put_into_systemboot
        // ---------------------------------------------------------
 

        onLog?.("check connection to mLRS receiver...");
        // Step 1: Probe/Ping (Conf=0, Action=0)
        let ack = false;
        // Try 3 times (reduced from 5 to save time if ACKs are missing)
        for (let i = 0; i < 3; i++) {
             await mav.commandLong(MAV_CMD_PREFLIGHT_REBOOT_SHUTDOWN, 0, 0, 0, MLRS_COMP_ID, 0, 0, MLRS_MAGIC_NUMBER, MLRS_SYS_ID, MLRS_COMP_ID, 0);
             if (await mav.waitForMwAck(MAV_CMD_PREFLIGHT_REBOOT_SHUTDOWN, MLRS_MAGIC_NUMBER, 500)) {
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
             await mav.commandLong(MAV_CMD_PREFLIGHT_REBOOT_SHUTDOWN, 1, 0, 3, MLRS_COMP_ID, 0, 0, MLRS_MAGIC_NUMBER, MLRS_SYS_ID, MLRS_COMP_ID, 1);
             if (await mav.waitForMwAck(MAV_CMD_PREFLIGHT_REBOOT_SHUTDOWN, MLRS_MAGIC_NUMBER, 500)) {
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
        await mav.disconnect();
    }
}
