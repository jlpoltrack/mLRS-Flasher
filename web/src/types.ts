export interface LogEntry {
  type: 'info' | 'error' | 'success' | 'warning' | 'stderr' | 'default';
  message: string;
  timestamp?: string;
}

export interface FirmwareFile {
  filename: string;
  url: string;
  size?: number;
}


export interface FirmwareMetadata {
  description?: string;
  raw_flashmethod?: string;
  needsPort?: boolean;
  hasWirelessBridge?: boolean;
  [key: string]: any;
}

export interface DeviceList {
  tx: string[];
  rx: string[];
  txint: string[];
}

export interface Version {
  version: string;
  versionStr: string;
  commit: string;
  gitUrl: string;
  date?: string;
}
