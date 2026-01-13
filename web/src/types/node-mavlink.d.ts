// type declarations for node-mavlink package
// note: these are minimal declarations matching actual usage in this project

declare module 'node-mavlink' {
    export class MavLinkPacketSplitter {
        constructor();
        on(event: 'data', callback: (buffer: Uint8Array) => void): void;
        on(event: 'error', callback: (error: Error) => void): void;
        write(data: Uint8Array): void;
    }

    export class MavLinkPacketParser {
        constructor();
        on(event: 'data', callback: (packet: MavLinkPacket) => void): void;
        on(event: 'error', callback: (error: Error) => void): void;
        write(data: Uint8Array): void;
    }

    export interface MavLinkPacketHeader {
        msgid: number;
        sysid: number;
        compid: number;
        seq: number;
        payloadLength: number;
    }

    export interface MavLinkPacket {
        header: MavLinkPacketHeader;
        payload: any;
        protocol: {
            data(payload: Uint8Array, clazz: any): any;
        };
    }

    export class MavLinkData {
        _message_id: number;
        _message_name: string;
    }

    export class MavLinkProtocolV2 {
        constructor(sysId: number, compId: number);
        serialize(msg: MavLinkData, seq: number): Uint8Array;
        static PAYLOAD_OFFSET: number;
    }

    export namespace minimal {
        export const REGISTRY: Record<number, any>;
        
        export class Heartbeat extends MavLinkData {
            type: number;
            autopilot: number;
            baseMode: number;
            customMode: number;
            systemStatus: number;
            mavlinkVersion: number;
        }
    }

    export namespace common {
        export const REGISTRY: Record<number, any>;
        
        export class ParamRequestRead extends MavLinkData {
            targetSystem: number;
            targetComponent: number;
            paramId: string;
            paramIndex: number;
        }

        export class ParamSet extends MavLinkData {
            targetSystem: number;
            targetComponent: number;
            paramId: string;
            paramValue: number;
            paramType: number;
        }

        export class ParamValue extends MavLinkData {
            paramId: string;
            paramValue: number;
            paramType: number;
            paramCount: number;
            paramIndex: number;
        }

        export class CommandLong extends MavLinkData {
            targetSystem: number;
            targetComponent: number;
            command: number;
            confirmation: number;
            param1: number;
            param2: number;
            param3: number;
            param4: number;
            param5: number;
            param6: number;
            param7: number;
        }

        export class CommandAck extends MavLinkData {
            command: number;
            result: number;
            progress: number;
            resultParam2: number;
            targetSystem: number;
            targetComponent: number;
        }
    }
}

