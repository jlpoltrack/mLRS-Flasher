interface SerialPortInfo {
  usbVendorId?: number;
  usbProductId?: number;
}

interface SerialPort {
  getInfo(): SerialPortInfo;
  open(options: { baudRate: number }): Promise<void>;
  close(): Promise<void>;
  readable: ReadableStream<Uint8Array> | null;
  writable: WritableStream<Uint8Array> | null;
}

interface Navigator {
  serial: {
    getPorts(): Promise<SerialPort[]>;
    requestPort(options?: { filters: Array<{ usbVendorId: number; usbProductId?: number }> }): Promise<SerialPort>;
  };
}
