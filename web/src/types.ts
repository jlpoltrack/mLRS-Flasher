import type { LogType } from './constants';

export interface LogEntry {
  type: LogType | 'stderr' | 'default';
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
  [key: string]: unknown;
}

export interface Version {
  version: string;
  versionStr: string;
  commit: string;
  gitUrl: string;
}
