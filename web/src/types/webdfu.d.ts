declare module 'webdfu' {
  export interface WebDFUOptions {
    forceInterfacesName?: boolean;
    process?: boolean;
    readSize?: number;
    writeSize?: number;
  }

  export interface WebDFULog {
    info(msg: string): void;
    warning(msg: string): void;
    progress(done: number, total: number): void;
  }

  export interface WebDFUProcess {
    events: {
      on(event: 'write/process', callback: (sent: number, total: number) => void): void;
      on(event: 'end', callback: () => void): void;
      on(event: 'error', callback: (err: Error) => void): void;
    }
  }

  // Represents the static DFU class which acts as a namespace/util
  export class DFU {
    static get DETACH(): number;
    static get DNLOAD(): number;
    static get UPLOAD(): number;
    static get GETSTATUS(): number;
    static get CLRSTATUS(): number;
    static get GETSTATE(): number;
    static get ABORT(): number;

    static get appIDLE(): number;
    static get appDETACH(): number;
    static get dfuIDLE(): number;
    static get dfuDNLOAD_SYNC(): number;
    static get dfuDNBUSY(): number;
    static get dfuDNLOAD_IDLE(): number;
    static get dfuMANIFEST_SYNC(): number;
    static get dfuMANIFEST(): number;
    static get dfuMANIFEST_WAIT_RESET(): number;
    static get dfuUPLOAD_IDLE(): number;
    static get dfuERROR(): number;

    static findDeviceDfuInterfaces(device: USBDevice): any[];
    static findAllDfuInterfaces(): Promise<DFUDevice[]>;
    static parseConfigurationDescriptor(data: DataView): {
        bConfigurationValue: number;
        descriptors: {
            bDescriptorType: number;
            bLength: number;
            bmAttributes?: number;
            wTransferSize?: number;
            wDetachTimeOut?: number;
            bcdDFUVersion?: number;
            [key: string]: any;
        }[];
    };
    
    // The device class wrapper
    static Device: typeof DFUDevice;
  }

  export class DFUDevice {
    constructor(device: USBDevice, settings: any);
    device_: USBDevice;
    settings: any;
    intfNumber: number;
    
    logDebug(msg: string): void;
    logInfo(msg: string): void;
    logWarning(msg: string): void;
    
    open(): Promise<void>;
    close(): Promise<void>;
    readConfigurationDescriptor(index: number): Promise<DataView>;
    readInterfaceNames(): Promise<{ [config: number]: { [intf: number]: { [alt: number]: string } } }>;
    
    download(data: ArrayBuffer, blockNum: number): Promise<number>;
    upload(length: number, blockNum: number): Promise<ArrayBuffer>;
    clearStatus(): Promise<void>;
    getStatus(): Promise<{ status: number, pollTimeout: number, state: number }>;
    getState(): Promise<number>;
    abort(): Promise<void>;
    abortToIdle(): Promise<void>;
    
    do_upload(xfer_size: number, max_size?: number, first_block?: number): Promise<Blob>;
    do_download(xfer_size: number, data: ArrayBuffer, manifestationTolerant: boolean): Promise<void>;
  }

  // DFUse (DFU with ST Extensions) for STM32 devices
  export class DFUse {
    static get GET_COMMANDS(): number;
    static get SET_ADDRESS(): number;
    static get ERASE_SECTOR(): number;
    
    static parseMemoryDescriptor(desc: string): {
        name: string;
        segments: {
            start: number;
            end: number;
            sectorSize: number;
            readable: boolean;
            erasable: boolean;
            writable: boolean;
        }[];
    };
    
    static Device: typeof DFUseDevice;
  }

  export class DFUseDevice extends DFUDevice {
    constructor(device: USBDevice, settings: any);
    memoryInfo: {
        name: string;
        segments: {
            start: number;
            end: number;
            sectorSize: number;
            readable: boolean;
            erasable: boolean;
            writable: boolean;
        }[];
    } | null;
    startAddress: number;
    
    dfuseCommand(command: number, param?: number, len?: number): Promise<void>;
    getSegment(addr: number): any;
    erase(startAddr: number, length: number): Promise<void>;
    do_download(xfer_size: number, data: ArrayBuffer, manifestationTolerant: boolean): Promise<void>;
  }
}
