declare module 'webdfu' {
  export interface WebDFUOptions {
    forceInterfacesName?: boolean;
    process?: boolean;
    readSize?: number;
    writeSize?: number;
  }

  export class WebDFU {
    constructor(device: USBDevice, options?: WebDFUOptions);
    init(): Promise<void>;
    connect(interfaceIndex: number): Promise<void>;
    disconnect(): Promise<void>;
    write(blockSize: number, data: ArrayBuffer, manifestation: boolean): Promise<void>;
    read(blockSize: number, length: number): Promise<ArrayBuffer>;
    detach(): Promise<void>;
    interfaces: any[];
  }
}
