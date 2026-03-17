import { useState, useEffect, useCallback, useMemo, useRef } from 'react';
import { usePersistentState } from '../hooks/usePersistentState';
import { useFirmwareLoader, useSerialPorts, useUSBDevices, useDefaultSelection } from '../hooks/useFirmwareLoader';
import { useStlinkDevices } from '../hooks/useStlinkDevices';
import { api } from '../api/webSerialApi';
import { findPortByName } from '../api/hardwareService';
import { InavPassthroughService, type MspPort } from '../api/inavPassthrough';
import { ArduPilotPassthroughService, type ArduPilotSerialPort } from '../api/ardupilotPassthrough';
import type { Version } from '../types';
import { FlashMethod, TargetType, BackendTarget, DEFAULT_FLASH_METHOD } from '../constants';
import './panel.css';

// last updated: 2026-03-17

// flash method used when in local-file mode (separate from the metadata-driven flashMethod)
// so toggling modes doesn't leave an invalid method from the other mode

const SERIAL_PORTS = ['SERIAL1', 'SERIAL2', 'SERIAL3', 'SERIAL4', 'SERIAL5', 'SERIAL6', 'SERIAL7', 'SERIAL8'];

// maps raw flash method values to user-friendly labels
function getFlashMethodLabel(m: string): string {
  if (m === FlashMethod.DFU) return 'DFU (USB)';
  if (m === FlashMethod.STLink) return 'STLink (SWD)';
  if (m === FlashMethod.UART) return 'SystemBoot (UART)';
  if (m === FlashMethod.ESPTool) return 'ESPTool (UART)';
  if (m === FlashMethod.ArduPilotPassthrough) return 'ArduPilot Passthrough';
  if (m === FlashMethod.InavPassthrough) return 'INAV Passthrough';
  return m;
}

interface FirmwareFlasherPanelProps {
  title: string;
  targetType: TargetType;
  versions: Version[];
  devices: string[];
  onFlash: (options: any) => void;
  isFlashing: boolean;
  flashTarget: BackendTarget | null;
  progress: number;
  showSerialX?: boolean;
  allowWirelessBridge?: boolean;
  useLocalFile: boolean;
}

function FirmwareFlasherPanel({
  title,
  targetType,
  versions,
  devices,
  onFlash,
  isFlashing,
  flashTarget,
  progress,
  showSerialX = false,
  allowWirelessBridge = false,
  useLocalFile,
}: FirmwareFlasherPanelProps) {
  const [selectedDevice, setSelectedDevice] = usePersistentState(`flasher_${targetType}_selectedDevice`, '');
  const [selectedVersion, setSelectedVersion] = usePersistentState(`flasher_${targetType}_selectedVersion`, '');
  const [stdFlashMethod, setStdFlashMethod] = usePersistentState(`flasher_${targetType}_flashMethod`, '');
  const [localFlashMethod, setLocalFlashMethod] = usePersistentState(`flasher_${targetType}_localFlashMethod`, '');
  const flashMethod = useLocalFile ? localFlashMethod : stdFlashMethod;
  const setFlashMethod = useLocalFile ? setLocalFlashMethod : setStdFlashMethod;
  const [serialX, setSerialX] = usePersistentState(`flasher_${targetType}_serialX`, 'SERIAL1');
  const [selectedElrsFile, setSelectedElrsFile] = usePersistentState(`flasher_${targetType}_selectedElrsFile`, '');

  // local file upload state
  const [localFile, setLocalFile] = useState<File | null>(null);
  const [localFileData, setLocalFileData] = useState<ArrayBuffer | null>(null);
  const [localBridgeFile, setLocalBridgeFile] = useState<File | null>(null);
  const [localBridgeFileData, setLocalBridgeFileData] = useState<ArrayBuffer | null>(null);
  const [localBridgeChipset, setLocalBridgeChipset] = useState<string>('esp8266');
  const [localChipset, setLocalChipset] = useState<string>('esp32');

  // inav passthrough state
  const [mspPorts, setMspPorts] = useState<MspPort[]>([]);
  const [isScanningMsp, setIsScanningMsp] = useState(false);
  const [targetUartIndex, setTargetUartIndex] = usePersistentState(`flasher_${targetType}_inavTargetUart`, '');

  // ardupilot passthrough state
  const [apPorts, setApPorts] = useState<ArduPilotSerialPort[]>([]);
  const [isScanningAp, setIsScanningAp] = useState(false);
  const [scanProgressLabel, setScanProgressLabel] = useState('Scanning FC ports...');
  const apScanAbortRef = useRef(false);
  const apServiceRef = useRef<ArduPilotPassthroughService | null>(null);

  // clear local file state when toggle is turned off
  useEffect(() => {
    if (!useLocalFile) {
      setLocalFile(null);
      setLocalFileData(null);
      setLocalBridgeFile(null);
      setLocalBridgeFileData(null);
      setLocalBridgeChipset('esp8266');
      setLocalChipset('esp32');
    }
  }, [useLocalFile]);

  // remove explicit state resets when switching between pages (target types)
  // as we now use targetType-specific keys in localStorage

  // use custom hooks for common functionality
  const {
    firmwareFiles,
    selectedFile,
    setSelectedFile,
    metadata,
    isLoadingFiles,
    error,
    setError,
  } = useFirmwareLoader(targetType, selectedDevice, selectedVersion);

  const {
    ports,
    selectedPort,
    setSelectedPort,
    isScanningPorts,
    refreshPorts,
  } = useSerialPorts(isFlashing, flashMethod, targetType);

  const {
    usbDevices,
    selectedUSBDevice,
    isScanningUSB,
    refreshUSBDevices,
  } = useUSBDevices(isFlashing);

  const {
    stlinkDevices,
    selectedStlink,
    isScanningStlink,
    refreshStlinks,
  } = useStlinkDevices();

  // set default selections when data loads
  useDefaultSelection(devices, selectedDevice, setSelectedDevice);
  useDefaultSelection(versions, selectedVersion, setSelectedVersion, v => v.version);

  // set default flash method when metadata loads (skip in local file mode)
  useEffect(() => {
    if (useLocalFile) return;
    if (metadata?.raw_flashmethod) {
      const methods = metadata.raw_flashmethod.split(',');
      // only set default if current method is invalid or 'default'
      // allow InavPassthrough even if not in metadata, as we inject it manually
      const currentMethodValid = methods.includes(flashMethod) || (flashMethod === FlashMethod.InavPassthrough && targetType === TargetType.Receiver);
      if (!flashMethod || flashMethod === DEFAULT_FLASH_METHOD || !currentMethodValid) {
          if (methods.length > 0) {
              setFlashMethod(methods[0]);
          }
      }
    } else if (!flashMethod) {
      setFlashMethod(DEFAULT_FLASH_METHOD);
    }
  }, [metadata, flashMethod, setFlashMethod, useLocalFile]);

  // select default ELRS file for R9 Tx
  useEffect(() => {
    if (selectedDevice?.includes('FrSky R9') && targetType === TargetType.TxExternal) {
      const elrsFiles = firmwareFiles.filter(f => f.filename.toLowerCase().endsWith('.elrs'));
      if (elrsFiles.length > 0) {
        if (!selectedElrsFile || !elrsFiles.find(f => f.filename === selectedElrsFile)) {
          setSelectedElrsFile(elrsFiles[0].filename);
        }
      } else {
        setSelectedElrsFile('');
      }
    }
  }, [selectedDevice, targetType, firmwareFiles, selectedElrsFile]);

  // auto-scan MSP ports when method or port changes
  useEffect(() => {
    if (flashMethod === FlashMethod.InavPassthrough && selectedPort) {
        // debounce to avoid duplicate scans from react strict mode
        const timer = setTimeout(() => scanMspPorts(), 100);
        return () => clearTimeout(timer);
    } else if (flashMethod !== FlashMethod.InavPassthrough) {
        setMspPorts([]);
    }
  }, [flashMethod, selectedPort]);

  // auto-scan AP ports when method or port changes
  useEffect(() => {
    if (flashMethod === FlashMethod.ArduPilotPassthrough && selectedPort) {
        apScanAbortRef.current = false;
        const timer = setTimeout(() => scanApPorts(), 100);
        return () => {
            clearTimeout(timer);
            apScanAbortRef.current = true;
            // disconnect any in-progress scan
            if (apServiceRef.current) {
                apServiceRef.current.disconnect().catch(() => {});
            }
        };
    } else if (flashMethod !== FlashMethod.ArduPilotPassthrough) {
        setApPorts([]);
    }
  }, [flashMethod, selectedPort]);

  const mspScanActiveRef = useRef(false);

  const scanMspPorts = useCallback(async () => {
    if (!selectedPort) return;
    
    // prevent overlapping scans (ref avoids stale closure)
    if (mspScanActiveRef.current) return;
    mspScanActiveRef.current = true;

    setIsScanningMsp(true);
    setMspPorts([]); // clear previous results while scanning
    setError(null);
    
    try {
        const port = await findPortByName(selectedPort);
        if (!port) return; 
        
        const service = new InavPassthroughService(port, (msg) => {
            // provide feedback during scan for common issues
            if (msg.includes("Timeout")) setError(`Scan Timeout on ${selectedPort}: Ensure FC is disarmed and Configurator is closed.`);
            if (msg.includes("Header Timeout")) setError(`No response from FC on ${selectedPort}. Check wiring/baud.`);
        });
        try {
            await service.connect();
            const ports = await service.getMspPorts();
            setMspPorts(ports);
        } catch (e: any) {
             console.error("MSP Scan failed:", e);
        } finally {
            try {
                await service.disconnect();
                await service.close();
            } catch (e) { /* ignore close errors */ }
        }
    } catch (e: any) {
        console.error("Port lookup failed:", e);
    } finally {
        mspScanActiveRef.current = false;
        setIsScanningMsp(false);
    }
  }, [selectedPort]);

  // auto-select MSP port when list updates
  useEffect(() => {
      if (mspPorts.length > 0) {
           const currentValid = mspPorts.find(p => p.index.toString() === targetUartIndex);
           if (!currentValid) {
               setTargetUartIndex(mspPorts[0].index.toString());
           }
      }
  }, [mspPorts, targetUartIndex, setTargetUartIndex]);

  const scanApPorts = useCallback(async () => {
    if (!selectedPort) return;
    if (isScanningAp) return;

    setIsScanningAp(true);
    setApPorts([]);
    setError(null);

    try {
        const port = await findPortByName(selectedPort);
        if (!port || apScanAbortRef.current) return;

        const service = new ArduPilotPassthroughService(port, (msg) => {
            if (msg.includes("Timeout") && !apScanAbortRef.current) {
                setError(`Scan Timeout on ${selectedPort}: Ensure FC is powered and connected.`);
            }
        });
        apServiceRef.current = service;

        try {
            const connected = await service.connect();
            if (apScanAbortRef.current) return;

            if (connected) {
                const ports = await service.getMavLinkPorts((msg) => {
                    if (!apScanAbortRef.current) setScanProgressLabel(msg);
                });
                if (apScanAbortRef.current) return;

                setApPorts(ports);
                if (ports.length === 0) {
                    setError(`No MAVLink ports found on FC. Check SERIAL_PROTOCOL settings.`);
                }
            } else {
                setError(`No ArduPilot heartbeat on ${selectedPort}. Ensure FC is connected and not in use.`);
            }
        } catch (e: any) {
            if (!apScanAbortRef.current) console.error("AP Scan failed:", e);
        } finally {
            apServiceRef.current = null;
            try {
                await service.disconnect();
                await new Promise(r => setTimeout(r, 200)); // let port fully release
            } catch { /* ignore close errors */ }
        }
    } catch (e: any) {
        console.error("Port lookup failed:", e);
    } finally {
        if (!apScanAbortRef.current) {
            setIsScanningAp(false);
            setScanProgressLabel('Scanning FC ports...');
        }
    }
  }, [selectedPort, isScanningAp]);

  // auto-select AP port when list updates
  useEffect(() => {
      if (apPorts.length > 0) {
           const currentValid = apPorts.find(p => `SERIAL${p.index}` === serialX);
           if (!currentValid) {
               setSerialX(`SERIAL${apPorts[0].index}`);
           }
      }
  }, [apPorts, serialX, setSerialX]);

  const handleFlash = useCallback(() => {
    // resolve firmware source: local file or github
    let flashFilename: string;
    let flashUrl: string | undefined;
    let flashFirmwareData: ArrayBuffer | undefined;

    if (useLocalFile) {
      if (!localFile || !localFileData) {
        setError('Please select a local firmware file first.');
        return;
      }
      flashFilename = localFile.name;
      flashFirmwareData = localFileData;
    } else {
      const file = firmwareFiles.find(f => f.filename === selectedFile);
      if (!file) return;
      flashFilename = file.filename;
      flashUrl = file.url;
    }

    // check for port requirement
    const needsPort = (flashMethod === FlashMethod.UART || flashMethod === FlashMethod.ESPTool || flashMethod === FlashMethod.ArduPilotPassthrough || flashMethod === FlashMethod.InavPassthrough || metadata?.needsPort);
    
    if (needsPort && !selectedPort) {
      setError('Please select a COM port first.');
      return;
    }

    if (flashMethod === FlashMethod.DFU && !selectedUSBDevice) {
       setError('Please select a USB device first.');
       return;
    }

    if (flashMethod === FlashMethod.STLink && !selectedStlink) {
       setError('Please select an ST-Link device first.');
       return;
    }

    if (flashMethod === FlashMethod.InavPassthrough && !targetUartIndex) {
        setError('Please select a valid MSP Port.');
        return;
    }

    // clear any previous error before starting
    setError(null);

    // special case for ardupilot passthrough that includes serial port info
    let programmer = 'auto';
    if (flashMethod === FlashMethod.ArduPilotPassthrough) {
       programmer = `ardupilot_passthrough ${serialX.toLowerCase()}`;
    }

    onFlash({
      type: targetType,
      programmer: programmer, 
      device: useLocalFile ? 'local' : selectedDevice,
      // empty string signals local file mode; backend skips github download when firmwareData is provided
      version: useLocalFile ? '' : selectedVersion,
      flashMethod: flashMethod,
      passthroughSerial: (flashMethod === FlashMethod.ArduPilotPassthrough) ? serialX : undefined,
      passthroughIdentifier: (flashMethod === FlashMethod.InavPassthrough) ? parseInt(targetUartIndex) : undefined,
      activationBaud: (flashMethod === FlashMethod.InavPassthrough) ? mspPorts.find(p => String(p.index) === String(targetUartIndex))?.baudRate : undefined,
      url: flashUrl,
      filename: flashFilename,
      firmwareData: flashFirmwareData,
      port: (flashMethod === FlashMethod.STLink) ? selectedStlink : (selectedPort || undefined),
      usbDeviceName: (flashMethod === FlashMethod.DFU) ? selectedUSBDevice : (flashMethod === FlashMethod.STLink ? (selectedStlink?.productName || 'ST-Link') : undefined),
      baudrate: (flashMethod === FlashMethod.UART) ? 115200 : undefined,
      target: targetType === TargetType.Receiver ? BackendTarget.Receiver : BackendTarget.TxModule,
      // send explicit chipset when local file mode has an mcu selector (tx internal, or receiver + esptool)
      chipset: (useLocalFile && (targetType === TargetType.TxInternal || (targetType === TargetType.Receiver && flashMethod === FlashMethod.ESPTool))) ? localChipset : undefined,
    });
  }, [firmwareFiles, selectedFile, flashMethod, selectedDevice, selectedVersion, selectedPort, selectedUSBDevice, selectedStlink, serialX, targetUartIndex, mspPorts, setError, onFlash, targetType, metadata, useLocalFile, localFile, localFileData, localChipset, setFlashMethod]);

  const handleFileChange = useCallback((e: React.ChangeEvent<HTMLInputElement>, isBridge = false) => {
    const file = e.target.files?.[0];
    if (!file) return;

    const reader = new FileReader();
    reader.onload = () => {
      if (isBridge) {
        setLocalBridgeFile(file);
        setLocalBridgeFileData(reader.result as ArrayBuffer);
      } else {
        setLocalFile(file);
        setLocalFileData(reader.result as ArrayBuffer);
      }
    };
    reader.onerror = () => setError('Failed to read file.');
    reader.readAsArrayBuffer(file);
  }, [setError]);

  const handleFlashWirelessBridge = useCallback(async () => {
    // use local bridge file if provided
    if (useLocalFile && localBridgeFile && localBridgeFileData) {
        // hardcoded wireless params mirror the metadata.wireless convention per chipset;
        // update here if new chipsets are added or defaults change
        const wirelessParams = localBridgeChipset === 'esp32c3'
          ? { reset: 'no dtr', baud: 115200, erase: 'full_erase' as string | undefined }
          : { reset: 'no dtr', baud: 115200, erase: undefined as string | undefined };
        setError(null);
        onFlash({
          type: targetType,
          programmer: 'esp wirelessbridge',
          device: selectedDevice,
          version: '',
          filename: localBridgeFile.name,
          firmwareData: localBridgeFileData,
          port: selectedPort || undefined,
          target: BackendTarget.WirelessBridge,
          reset: wirelessParams.reset,
          baudrate: wirelessParams.baud,
          erase: wirelessParams.erase,
          flashMethod: FlashMethod.ESPTool,
          chipset: localBridgeChipset,
        });
        return;
    }

    if (!metadata?.wireless?.chipset) {
        setError("Wireless bridge chipset not defined in metadata.");
        return;
    }

    try {
        const files = await api.listWirelessBridgeFirmware({
            version: selectedVersion,
            chipset: metadata.wireless.chipset
        });
        
        if (files.length === 0) {
            setError(`No wireless bridge firmware found for chipset ${metadata.wireless.chipset}`);
            return;
        }

        const file = files[0];

        onFlash({
          type: targetType,
          programmer: 'esp wirelessbridge',
          device: selectedDevice,
          version: selectedVersion,
          url: file.url,
          filename: file.filename,
          port: selectedPort || undefined,
          target: BackendTarget.WirelessBridge,
          reset: metadata.wireless.reset,
          baudrate: metadata.wireless.baud,
          erase: metadata.wireless.erase
        });
    } catch (e) {
        console.error(e);
        setError("Failed to locate wireless bridge firmware.");
    }
  }, [metadata, selectedVersion, selectedDevice, selectedPort, onFlash, targetType, setError, useLocalFile, localBridgeFile, localBridgeFileData, localBridgeChipset]);

  const isDevVersion = selectedVersion?.includes('dev');
  const isFrSkyR9 = selectedDevice?.includes('FrSky R9');
  const isR9Rx = isFrSkyR9 && targetType === TargetType.Receiver;
  const isR9Tx = selectedDevice?.includes('FrSky R9') && targetType === TargetType.TxExternal;

  // enforce allowed methods for R9 Rx/Tx
  useEffect(() => {
    if (isR9Rx) {
      if (flashMethod !== FlashMethod.STLink && flashMethod !== FlashMethod.ArduPilotPassthrough) {
        setFlashMethod(FlashMethod.STLink);
      }
      
      // enforce HEX selection for R9 Rx if using STLink
      if (flashMethod === FlashMethod.STLink && firmwareFiles.length > 0) {
          const currentIsElrs = selectedFile?.toLowerCase().endsWith('.elrs');
          const currentIsHex = selectedFile?.toLowerCase().endsWith('.hex');
          
          if (!currentIsElrs && !currentIsHex) {
              const hex = firmwareFiles.find(f => f.filename.toLowerCase().endsWith('.hex'));
              if (hex) setSelectedFile(hex.filename);
          }
      }
    } else if (isR9Tx) {
       // force STLink for R9 Tx if method is not set or default
        if (!flashMethod || flashMethod === DEFAULT_FLASH_METHOD) {
            setFlashMethod(FlashMethod.STLink);
        }
    }
  }, [isR9Rx, isR9Tx, flashMethod, firmwareFiles, selectedFile, setSelectedFile]);

  // available flash methods for local file mode (target-specific)
  const localFlashMethods = useMemo(() => {
    if (targetType === TargetType.TxInternal) {
      // tx internal modules are all esp-based
      return [{ value: FlashMethod.ESPTool, label: 'ESPTool (UART)' }];
    }
    const methods: { value: string; label: string }[] = [
      { value: FlashMethod.UART, label: 'SystemBoot (UART)' },
      { value: FlashMethod.DFU, label: 'DFU (USB)' },
      { value: FlashMethod.ESPTool, label: 'ESPTool (UART)' },
      { value: FlashMethod.STLink, label: 'STLink (SWD)' },
    ];
    if (targetType === TargetType.Receiver) {
      methods.push({ value: FlashMethod.ArduPilotPassthrough, label: 'ArduPilot Passthrough' });
    }
    return methods;
  }, [targetType]);

  const showFlashMethodSelector = localFlashMethods.length > 1;
  const localHasMcuSelector = targetType === TargetType.TxInternal || (targetType === TargetType.Receiver && flashMethod === FlashMethod.ESPTool);
  const filePickerSpanClass = (showFlashMethodSelector && localHasMcuSelector) ? 'span-2' : (showFlashMethodSelector || localHasMcuSelector) ? 'span-3' : 'full-width';

  // set default flash method for local file mode
  useEffect(() => {
    if (!useLocalFile) return;
    const validValues = localFlashMethods.map(m => m.value);
    if (!flashMethod || !validValues.includes(flashMethod)) {
      setFlashMethod(validValues[0]);
    }
  }, [useLocalFile, localFlashMethods, flashMethod, setFlashMethod]);

  const flashButtonLabel = targetType === TargetType.Receiver ? 'Flash Receiver' : 'Flash Tx Module';
  const flashBackendTarget = targetType === TargetType.Receiver ? BackendTarget.Receiver : BackendTarget.TxModule;

  // shared device-selector row helpers; closures capture component state
  const renderComPortRow = (
    flashDisabled: boolean,
    flashTooltip: string | undefined,
    extraButtons?: React.ReactNode,
    hideFlashButton = false
  ) => (
    <div className="form-group port-group full-width">
      <label>COM Port</label>
      <div className="port-row">
        <div className="select-wrapper">
          <select
            value={selectedPort}
            onChange={(e) => {
              setSelectedPort(e.target.value);
              setError(null);
            }}
            disabled={isFlashing || isScanningPorts}
          >
            {ports.length === 0 ? (
              <option value="">No authorized devices</option>
            ) : (
              ports.map(port => (
                <option key={port} value={port}>{port}</option>
              ))
            )}
          </select>
        </div>
        <button
          className="btn-secondary"
          onClick={() => refreshPorts({ request: true })}
          disabled={isFlashing || isScanningPorts}
          title={isScanningPorts ? 'Scanning for ports...' : 'Authorize a new serial device'}
          aria-label="Scan for serial ports"
        >
          {isScanningPorts ? 'Scanning...' : 'Add Device'}
        </button>

        {!hideFlashButton && (
          <div title={flashTooltip}>
            <button
              className="btn-primary btn-flash"
              onClick={handleFlash}
              disabled={flashDisabled}
              aria-label={`${flashButtonLabel} firmware`}
            >
              {isFlashing && flashTarget === flashBackendTarget ?
                (progress > 0 ? `Flashing... ${progress}%` : 'Flashing...') :
                flashButtonLabel}
            </button>
          </div>
        )}

        {extraButtons}

        {isFlashing && (
          <button
            className="btn-secondary btn-cancel"
            onClick={() => api.cancelPython()}
          >
            Cancel
          </button>
        )}
      </div>
    </div>
  );

  const renderDfuRow = (
    flashDisabled: boolean,
    flashTooltip: string | undefined
  ) => (
    <div className="form-group port-group full-width">
      <label>USB Device (DFU)</label>
      <div className="port-row">
        {selectedUSBDevice ? (
          <>
            <div className="static-display">
              {selectedUSBDevice}
            </div>
            <button
              className="btn-secondary"
              onClick={() => refreshUSBDevices({ request: true })}
              disabled={isFlashing || isScanningUSB}
            >
              Change Device
            </button>
          </>
        ) : (
          <>
            <div className="select-wrapper">
              <select
                value=""
                onChange={() => {}}
                disabled={usbDevices.length === 0}
              >
                {usbDevices.length === 0 ? (
                  <option>No DFU devices found</option>
                ) : (
                  <>
                    <option value="" disabled>Select device...</option>
                    {usbDevices.map(d => <option key={d} value={d}>{d}</option>)}
                  </>
                )}
              </select>
            </div>
            <button
              className="btn-secondary"
              onClick={() => refreshUSBDevices({ request: true })}
              disabled={isFlashing || isScanningUSB}
            >
              {isScanningUSB ? 'Scanning...' : 'Add Device'}
            </button>
          </>
        )}

        <div title={flashTooltip}>
          <button
            className="btn-primary btn-flash"
            onClick={handleFlash}
            disabled={flashDisabled}
            aria-label={`${flashButtonLabel} firmware`}
          >
            {isFlashing && flashTarget === flashBackendTarget ?
              (progress > 0 ? `Flashing... ${progress}%` : 'Flashing...') :
              flashButtonLabel}
          </button>
        </div>

        {isFlashing && (
          <button
            className="btn-secondary btn-cancel"
            onClick={() => api.cancelPython()}
          >
            Cancel
          </button>
        )}
      </div>
    </div>
  );

  const renderStlinkRow = (
    flashDisabled: boolean,
    flashTooltip: string | undefined
  ) => (
    <div className="form-group port-group full-width">
      <label>ST-Link Device (SWD)</label>
      <div className="port-row">
        {selectedStlink ? (
          <>
            <div className="static-display">
              {selectedStlink.productName || 'ST-Link'}
            </div>
            <button
              className="btn-secondary"
              onClick={() => refreshStlinks({ request: true })}
              disabled={isFlashing || isScanningStlink}
            >
              Change Device
            </button>
          </>
        ) : (
          <>
            <div className="select-wrapper">
              <select
                value=""
                onChange={() => {}}
                disabled={stlinkDevices.length === 0}
              >
                {stlinkDevices.length === 0 ? (
                  <option>No paired ST-Link devices</option>
                ) : (
                  <>
                    <option value="" disabled>Select device...</option>
                    {stlinkDevices.map((d, i) => <option key={i} value={d.serialNumber}>{d.productName || `ST-Link ${i+1}`}</option>)}
                  </>
                )}
              </select>
            </div>
            <button
              className="btn-secondary"
              onClick={() => refreshStlinks({ request: true })}
              disabled={isFlashing || isScanningStlink}
            >
              {isScanningStlink ? 'Scanning...' : 'Add Device'}
            </button>
          </>
        )}

        <div title={flashTooltip}>
          <button
            className="btn-primary btn-flash"
            onClick={handleFlash}
            disabled={flashDisabled}
            aria-label={`${flashButtonLabel} firmware`}
          >
            {isFlashing && flashTarget === flashBackendTarget ?
              (progress > 0 ? `Flashing... ${progress}%` : 'Flashing...') :
              flashButtonLabel}
          </button>
        </div>

        {isFlashing && (
          <button
            className="btn-secondary btn-cancel"
            onClick={() => api.cancelPython()}
          >
            Cancel
          </button>
        )}
      </div>
    </div>
  );

  // --- local file mode ui ---
  const renderLocalFileUI = () => (
    <div className="form-grid">
      {/* row 1: flash method + mcu selector (tx internal, or receiver + esptool) + local file picker */}
      {showFlashMethodSelector && (
        <div className="form-group span-1">
          <label>Flash Method</label>
          <div className="select-wrapper">
            <select
              value={flashMethod}
              onChange={(e) => setFlashMethod(e.target.value)}
              disabled={isFlashing}
            >
              {localFlashMethods.map(m => (
                <option key={m.value} value={m.value}>{m.label}</option>
              ))}
            </select>
          </div>
        </div>
      )}
      {targetType === TargetType.TxInternal && (
        <div className="form-group span-1">
          <label>Main Module</label>
          <div className="select-wrapper">
            <select
              value={localChipset}
              onChange={(e) => setLocalChipset(e.target.value)}
              disabled={isFlashing}
            >
              <option value="esp32">ESP32</option>
              <option value="esp32s3">ESP32-S3</option>
            </select>
          </div>
        </div>
      )}
      {targetType === TargetType.Receiver && flashMethod === FlashMethod.ESPTool && (
        <div className="form-group span-1">
          <label>MCU</label>
          <div className="select-wrapper">
            <select
              value={localChipset}
              onChange={(e) => setLocalChipset(e.target.value)}
              disabled={isFlashing}
            >
              <option value="esp32">ESP32</option>
              <option value="esp32s3">ESP32-S3</option>
              <option value="esp32c3">ESP32-C3</option>
              <option value="esp8266">ESP8266</option>
            </select>
          </div>
        </div>
      )}
      <div className={`form-group ${filePickerSpanClass}`}>
        {(showFlashMethodSelector || localHasMcuSelector) && <label>&nbsp;</label>}
        <div className="local-file-input">
          <input
            type="file"
            accept=".bin,.hex,.elrs"
            onChange={(e) => handleFileChange(e)}
            disabled={isFlashing}
            id={`local-file-${targetType}`}
          />
          <label htmlFor={`local-file-${targetType}`} className="btn-secondary file-select-btn">
            {localFile ? localFile.name : 'Choose Local File...'}
          </label>
          {localFile && (
            <span className="file-size">({(localFile.size / 1024).toFixed(1)} KB)</span>
          )}
        </div>
      </div>

      {/* passthrough serial selector for ardupilot passthrough */}
      {showSerialX && flashMethod === FlashMethod.ArduPilotPassthrough && (
        <div className="form-group full-width">
          <label>Passthrough Serial</label>
          <div className="select-wrapper">
            <select
              value={serialX}
              onChange={(e) => setSerialX(e.target.value)}
              disabled={isFlashing}
            >
              {SERIAL_PORTS.map(p => (
                <option key={p} value={p}>{p}</option>
              ))}
            </select>
          </div>
        </div>
      )}

      {/* device selectors */}
      {(flashMethod === FlashMethod.UART || flashMethod === FlashMethod.ESPTool || flashMethod === FlashMethod.ArduPilotPassthrough) &&
        renderComPortRow(
          isFlashing || !localFileData || !selectedPort,
          !localFile ? 'Select a local file first' : !selectedPort ? 'Select a COM port first' : isFlashing ? 'Flashing in progress' : undefined
        )
      }

      {flashMethod === FlashMethod.DFU &&
        renderDfuRow(
          isFlashing || !localFileData || !selectedUSBDevice,
          !localFile ? 'Select a local file first' : !selectedUSBDevice ? 'Select a USB device first' : isFlashing ? 'Flashing in progress' : undefined
        )
      }

      {flashMethod === FlashMethod.STLink &&
        renderStlinkRow(
          isFlashing || !localFileData || !selectedStlink,
          !localFile ? 'Select a local file first' : !selectedStlink ? 'Select an ST-Link device first' : isFlashing ? 'Flashing in progress' : undefined
        )
      }

      {/* bridge chipset + file — visible when wireless bridge is available */}
      {allowWirelessBridge && (
        <>
          <div className="form-group span-1">
            <label>Wireless Bridge</label>
            <div className="select-wrapper">
              <select
                value={localBridgeChipset}
                onChange={(e) => setLocalBridgeChipset(e.target.value)}
                disabled={isFlashing}
              >
                <option value="esp8266">ESP8266</option>
                <option value="esp32c3">ESP32-C3</option>
              </select>
            </div>
          </div>
          <div className="form-group span-3">
            <label>&nbsp;</label>
            <div className="local-file-input">
              <input
                type="file"
                accept=".bin"
                onChange={(e) => handleFileChange(e, true)}
                disabled={isFlashing}
                id={`local-bridge-file-${targetType}`}
              />
              <label htmlFor={`local-bridge-file-${targetType}`} className="btn-secondary file-select-btn">
                {localBridgeFile ? localBridgeFile.name : 'Choose Bridge File...'}
              </label>
              {localBridgeFile && (
                <span className="file-size">({(localBridgeFile.size / 1024).toFixed(1)} KB)</span>
              )}
            </div>
          </div>
        </>
      )}

      {/* bridge serial port + flash button — reuses shared com port helper */}
      {allowWirelessBridge && (
        renderComPortRow(
          isFlashing || !localBridgeFileData || !selectedPort,
          !localBridgeFile ? 'Select a wireless bridge file first' : !selectedPort ? 'Select a COM port first' : isFlashing ? 'Flashing in progress' : undefined,
          <div title={!localBridgeFile ? 'Select a wireless bridge file first' : !selectedPort ? 'Select a COM port first' : isFlashing ? 'Flashing in progress' : undefined}>
            <button
              className="btn-primary btn-flash"
              onClick={handleFlashWirelessBridge}
              disabled={isFlashing || !localBridgeFileData || !selectedPort}
              aria-label="Flash Wireless Bridge firmware"
            >
              {isFlashing && flashTarget === BackendTarget.WirelessBridge ? (progress > 0 ? `Flashing... ${progress}%` : 'Flashing...') : 'Flash Wireless Bridge'}
            </button>
          </div>,
          true
        )
      )}
    </div>
  );

  // --- standard mode ui ---
  const renderStandardUI = () => (
    <div className="form-grid">
      <div className="form-group span-1">
        <label>Device Type</label>
        <div className="select-wrapper">
          <select
            value={selectedDevice}
            onChange={(e) => setSelectedDevice(e.target.value)}
            disabled={isFlashing}
          >
            {devices.map(device => (
              <option key={device} value={device}>{device}</option>
            ))}
          </select>
        </div>
      </div>

      <div className="form-group span-1">
        <label>Firmware Version</label>
        <div className="select-wrapper">
          <select
            value={selectedVersion}
            onChange={(e) => setSelectedVersion(e.target.value)}
            disabled={isFlashing}
          >
            {versions.map(v => (
              <option key={v.version} value={v.version}>{v.versionStr}</option>
            ))}
          </select>
        </div>
      </div>

      <div className="form-group span-2">
        <label>Firmware File</label>
        <div className="select-wrapper">
          <select
            value={selectedFile}
            onChange={(e) => setSelectedFile(e.target.value)}
            disabled={isFlashing || isLoadingFiles}
          >
            {isLoadingFiles ? (
              <option>Loading...</option>
            ) : firmwareFiles.length === 0 ? (
              <option>No files available</option>
            ) : (
              firmwareFiles
                .filter(file => (!isR9Rx && !isR9Tx) || !file.filename.toLowerCase().endsWith('.elrs'))
                .map(file => (
                  <option key={file.filename} value={file.filename}>{file.filename}</option>
                ))
            )}
          </select>
        </div>
      </div>

      {/* file driven ui logic */}
      {(() => {
        return (
          <>
            {/* flash method & port selection */}
            <>
              {/* flash method selection */}
              {(metadata?.raw_flashmethod?.includes(',') || isR9Tx || flashMethod === FlashMethod.InavPassthrough) && (
                <>
                  {((showSerialX && flashMethod === FlashMethod.ArduPilotPassthrough) || flashMethod === FlashMethod.InavPassthrough) ? (
                    <>
                      <div className="form-group span-2">
                        <label>Flash Method</label>
                        <div className="select-wrapper">
                          <select
                            value={flashMethod}
                            onChange={(e) => setFlashMethod(e.target.value)}
                            disabled={isFlashing}
                          >
                            {[...(metadata?.raw_flashmethod?.split(',') || []), FlashMethod.InavPassthrough]
                              .filter((v, i, a) => a.indexOf(v) === i)
                              .filter(m => m !== FlashMethod.InavPassthrough || targetType === TargetType.Receiver)
                              .map((m: string) => (
                                <option key={m} value={m}>{getFlashMethodLabel(m)}</option>
                              ))}
                          </select>
                        </div>
                      </div>

                      {flashMethod === FlashMethod.ArduPilotPassthrough && (
                      <div className="form-group span-2">
                        <label>Passthrough Serial</label>
                        <div className="select-wrapper">
                          <select
                            value={serialX}
                            onChange={(e) => setSerialX(e.target.value)}
                            disabled={isFlashing || isScanningAp || apPorts.length === 0}
                          >
                            {isScanningAp ? (
                              <option>{scanProgressLabel}</option>
                            ) : apPorts.length > 0 ? (
                              apPorts.map(p => (
                                <option key={p.index} value={`SERIAL${p.index}`}>{p.name}</option>
                              ))
                            ) : (
                              <option>No MAVLink ports found</option>
                            )}
                          </select>
                        </div>
                      </div>
                      )}

                      {flashMethod === FlashMethod.InavPassthrough && (
                      <div className="form-group span-2">
                        <label>MSP Port</label>
                        <div className="select-wrapper">
                          <select
                            value={targetUartIndex}
                            onChange={(e) => setTargetUartIndex(e.target.value)}
                            disabled={isFlashing || isScanningMsp}
                          >
                            {isScanningMsp ? (
                              <option>Scanning FC ports...</option>
                            ) : mspPorts.length === 0 ? (
                              <option value="" disabled>No MSP ports found</option>
                            ) : (
                              mspPorts.map(p => (
                                <option key={p.index} value={p.index}>{p.name}</option>
                              ))
                            )}
                            {/* fallback if user wants to set manually but hasn't scanned */}
                            {!isScanningMsp && mspPorts.length === 0 && targetUartIndex && (
                              <option value={targetUartIndex}>UART {parseInt(targetUartIndex) + 1}</option>
                            )}
                          </select>
                        </div>
                      </div>
                      )}
                    </>
                  ) : (
                    <div className="form-group full-width">
                      <label>Flash Method</label>
                      <div className="select-wrapper">
                        <select
                          value={flashMethod}
                          onChange={(e) => setFlashMethod(e.target.value)}
                          disabled={isFlashing}
                        >
                          {[...(metadata?.raw_flashmethod?.split(',') || []), FlashMethod.InavPassthrough]
                            .filter((v, i, a) => a.indexOf(v) === i)
                            .filter(m => m !== FlashMethod.InavPassthrough || targetType === TargetType.Receiver)
                            .filter((m: string) => !isR9Rx || m === FlashMethod.STLink || m === FlashMethod.ArduPilotPassthrough || m === FlashMethod.InavPassthrough)
                            .map((m: string) => (
                              <option key={m} value={m}>{getFlashMethodLabel(m)}</option>
                            ))}
                        </select>
                      </div>
                    </div>
                  )}
                </>
              )}

              {/* com port selection — shown for serial-based methods; r9 only shows port for passthrough */}
              {(flashMethod === FlashMethod.UART || flashMethod === FlashMethod.ESPTool || flashMethod === FlashMethod.ArduPilotPassthrough || flashMethod === FlashMethod.InavPassthrough) && (!isFrSkyR9 || (isFrSkyR9 && (flashMethod === FlashMethod.ArduPilotPassthrough || flashMethod === FlashMethod.InavPassthrough))) &&
                renderComPortRow(
                  isFlashing || !selectedFile || firmwareFiles.length === 0 || isLoadingFiles || !selectedPort,
                  isFlashing ? 'Flashing in progress' : !selectedFile || firmwareFiles.length === 0 ? 'Select a firmware file first' : isLoadingFiles ? 'Loading firmware files...' : !selectedPort ? 'Select a COM port first' : undefined,
                  allowWirelessBridge && metadata?.hasWirelessBridge && (
                    <div title={isFlashing ? 'Flashing in progress' : !selectedFile ? 'Select a firmware file first' : !selectedPort ? 'Select a COM port first' : undefined}>
                      <button
                        className="btn-primary btn-flash"
                        onClick={handleFlashWirelessBridge}
                        disabled={isFlashing || !selectedFile || firmwareFiles.length === 0 || !selectedPort}
                        aria-label="Flash Wireless Bridge firmware"
                      >
                        {isFlashing && flashTarget === BackendTarget.WirelessBridge ? (progress > 0 ? `Flashing... ${progress}%` : 'Flashing...') : 'Flash Wireless Bridge'}
                      </button>
                    </div>
                  )
                )
              }

              {/* usb device selection (dfu) */}
              {flashMethod === FlashMethod.DFU &&
                renderDfuRow(
                  isFlashing || !selectedFile || firmwareFiles.length === 0 || isLoadingFiles || !selectedUSBDevice,
                  isFlashing ? 'Flashing in progress' : !selectedFile || firmwareFiles.length === 0 ? 'Select a firmware file first' : isLoadingFiles ? 'Loading firmware files...' : !selectedUSBDevice ? 'Select a USB device first' : undefined
                )
              }

              {/* st-link selection */}
              {flashMethod === FlashMethod.STLink &&
                renderStlinkRow(
                  isFlashing || !selectedFile || firmwareFiles.length === 0 || isLoadingFiles || !selectedStlink,
                  isFlashing ? 'Flashing in progress' : !selectedFile || firmwareFiles.length === 0 ? 'Select a firmware file first' : isLoadingFiles ? 'Loading firmware files...' : !selectedStlink ? 'Select an ST-Link device first' : undefined
                )
              }
            </>

            {/* elrs bootloader card - show for r9 tx */}
            {isR9Tx && (
              <div className="form-group full-width" style={{ marginTop: '16px', marginBottom: '16px' }}>
                <div className="external-flash-card" style={{ marginTop: 0 }}>
                  <div className="flash-card-header" style={{ flexDirection: 'row', justifyContent: 'space-between', alignItems: 'center', gap: '8px' }}>
                    <div style={{ display: 'flex', alignItems: 'center', gap: '12px' }}>
                      <div className="flash-card-icon" style={{ background: 'rgba(59, 130, 246, 0.15)', color: '#60a5fa' }}>💾</div>
                      <div>
                        <div className="flash-card-title">ELRS Bootloader Firmware</div>
                        <div className="flash-card-desc">Download .elrs file</div>
                      </div>
                    </div>

                    <div style={{ display: 'flex', gap: '8px', alignItems: 'center' }}>
                      <div className="select-wrapper" style={{ width: '300px' }}>
                        <select
                          value={selectedElrsFile}
                          onChange={(e) => setSelectedElrsFile(e.target.value)}
                          disabled={isLoadingFiles}
                        >
                          {firmwareFiles.filter(f => f.filename.toLowerCase().endsWith('.elrs')).length === 0 ? (
                            <option>No .elrs files</option>
                          ) : (
                            firmwareFiles
                              .filter(f => f.filename.toLowerCase().endsWith('.elrs'))
                              .map(f => (
                                <option key={f.filename} value={f.filename}>{f.filename}</option>
                              ))
                          )}
                        </select>
                      </div>
                      <a
                        href={firmwareFiles.find(f => f.filename === selectedElrsFile)?.url}
                        download={selectedElrsFile}
                        className={`btn-download ${!selectedElrsFile ? 'disabled' : ''}`}
                        style={{ display: 'inline-flex', justifyContent: 'center', alignItems: 'center', textDecoration: 'none', height: '38px', whiteSpace: 'nowrap' }}
                        onClick={(e) => !selectedElrsFile && e.preventDefault()}
                      >
                        Download
                      </a>
                    </div>
                  </div>

                  <div className="flash-steps" style={{
                    background: 'rgba(15, 23, 42, 0.5)',
                    border: '1px solid rgba(0, 217, 255, 0.3)',
                    gap: '8px',
                    boxShadow: '0 4px 12px rgba(0, 0, 0, 0.2), 0 0 10px rgba(0, 217, 255, 0.08)'
                  }}>
                    <div className="flash-step">
                      <span>Download the .elrs firmware file</span>
                    </div>
                    <div className="flash-step">
                      <span>Copy the file to the SD Card of your radio and place it in the firmware folder</span>
                    </div>
                    <div className="flash-step">
                      <span>Flash the module by navigating to the firmware folder, selecting the .elrs file and clicking 'Flash external module'</span>
                    </div>
                  </div>
                </div>
              </div>
            )}
          </>
        );
      })()}
    </div>
  );

  return (
    <div className="panel">
      <h2 className="panel-title">{title}</h2>

      {error && (
        <div className="error-box">
          <strong>❌ Error:</strong> {error}
        </div>
      )}

      {useLocalFile ? renderLocalFileUI() : renderStandardUI()}

      {!useLocalFile && isDevVersion && (
        <div className="warning-box">
          <strong>⚠️ Warning:</strong> You are about to flash a 'dev' firmware version.
          Please ensure you understand the risks involved.
        </div>
      )}

      {!useLocalFile && metadata?.description && (
        <div className="description-box">
          <div className="flash-card-header">
             <div className="flash-card-title">Flashing Notes</div>
          </div>
          <div className="description-content">
            {metadata.description.trim().split('\n').filter((line: string) => line.trim() !== '').map((line: string, i: number) => (
              <div key={i}>{line}</div>
            ))}
          </div>
        </div>
      )}

    </div>
  );
}

export default FirmwareFlasherPanel;
