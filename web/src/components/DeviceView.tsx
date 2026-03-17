// DeviceView.tsx - unified component replacing Receiver, TxModuleExternal, TxModuleInternal
// last updated: 2026-02-09

import FirmwareFlasherPanel from './FirmwareFlasherPanel';
import { DEVICE_CONFIGS, TargetType, BackendTarget } from '../constants';
import type { Version } from '../types';

interface DeviceViewProps {
  targetType: TargetType;
  versions: Version[];
  devices: string[];
  onFlash: (options: any) => void;
  isFlashing: boolean;
  flashTarget: BackendTarget | null;
  progress: number;
  useLocalFile: boolean;
}

function DeviceView({ targetType, ...props }: DeviceViewProps) {
  const config = DEVICE_CONFIGS[targetType];
  
  return (
    <FirmwareFlasherPanel
      title={config.title}
      targetType={targetType}
      showSerialX={config.showSerialX}
      allowWirelessBridge={config.allowWirelessBridge}
      {...props}
    />
  );
}

export default DeviceView;
