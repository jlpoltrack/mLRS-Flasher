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

export interface WirelessBridgeConfig {
  chipset?: string;
  erase?: string;
  baud?: number;
  reset?: string;
}

export interface FirmwareMetadata {
  description?: string;
  raw_flashmethod?: string;
  needsPort?: boolean;
  hasWirelessBridge?: boolean;
  isWirelessBridgeFirmware?: boolean;
  chipset?: string;
  erase?: string;
  wireless?: WirelessBridgeConfig;
  [key: string]: unknown;
}

export interface Version {
  version: string;
  versionStr: string;
  commit: string;
  gitUrl: string;
}
