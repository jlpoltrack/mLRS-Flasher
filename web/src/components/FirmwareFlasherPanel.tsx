import { useEffect, useCallback } from 'react';
import { usePersistentState } from '../hooks/usePersistentState';
import { useFirmwareLoader, useSerialPorts, useUSBDevices, useDefaultSelection } from '../hooks/useFirmwareLoader';
import { useStlinkDevices } from '../hooks/useStlinkDevices';
import { api } from '../api/webSerialApi';
import type { Version } from '../types';
import { FlashMethod, TargetType, BackendTarget, DEFAULT_FLASH_METHOD } from '../constants';
import './panel.css';

// last updated: 2026-03-09

const SERIAL_PORTS = ['SERIAL1', 'SERIAL2', 'SERIAL3', 'SERIAL4', 'SERIAL5', 'SERIAL6', 'SERIAL7', 'SERIAL8'];

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
}: FirmwareFlasherPanelProps) {
  const [selectedDevice, setSelectedDevice] = usePersistentState(`flasher_${targetType}_selectedDevice`, '');
  const [selectedVersion, setSelectedVersion] = usePersistentState(`flasher_${targetType}_selectedVersion`, '');
  const [flashMethod, setFlashMethod] = usePersistentState(`flasher_${targetType}_flashMethod`, '');
  const [serialX, setSerialX] = usePersistentState(`flasher_${targetType}_serialX`, 'SERIAL1');
  const [selectedElrsFile, setSelectedElrsFile] = usePersistentState(`flasher_${targetType}_selectedElrsFile`, '');

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
    usbDevices, // Destructured
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

  // set default flash method when metadata loads
  useEffect(() => {
    if (metadata?.raw_flashmethod) {
      const methods = metadata.raw_flashmethod.split(',');
      // Only set default if current method is invalid or 'default'
      const currentMethodValid = methods.includes(flashMethod);
      if (!flashMethod || flashMethod === DEFAULT_FLASH_METHOD || !currentMethodValid) {
          if (methods.length > 0) {
              setFlashMethod(methods[0]);
          }
      }
    } else if (!flashMethod) {
      setFlashMethod(DEFAULT_FLASH_METHOD);
    }
  }, [metadata, flashMethod, setFlashMethod]);

  // Select default ELRS file for R9 Tx
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

  const handleFlash = useCallback(() => {
    const file = firmwareFiles.find(f => f.filename === selectedFile);
    if (!file) return;

    // Check for port requirement
    // FIX: logic now allows selecting port for appassthru if needed, but appassthru usually needs it passed
    // the previous bug was that we didn't force port selection for appassthru in Python,
    // but the UI needs to let the user select it if the method is UART-based or appassthru
    const needsPort = (flashMethod === FlashMethod.UART || flashMethod === FlashMethod.ESPTool || flashMethod === FlashMethod.APPassthru || metadata?.needsPort);
    
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

    // clear any previous error before starting
    setError(null);

    // We no longer construct a complex programmer string here.
    // We pass the device and flash method to the backend, which resolves the details.
    
    // special case for appassthru that includes serial port info
    let programmer = 'auto'; // default
    if (flashMethod === FlashMethod.APPassthru) {
       // preserve legacy behavior for appassthru which might expect 'stm32 appassthru serialX'
       // actually, the backend refactor now handles 'serialX' via provided_programmer or separate arg?
       // Let's pass the serial info in the programmer string for now to be safe with the new backend logic
       // which checks provided_programmer for 'serial'
       programmer = `appassthru ${serialX.toLowerCase()}`;
    }

    onFlash({
      type: targetType,
      programmer: programmer, 
      device: selectedDevice,
      version: selectedVersion,
      flashMethod: flashMethod,
      passthroughSerial: (flashMethod === FlashMethod.APPassthru) ? serialX : undefined,
      url: file.url,
      filename: file.filename,
      port: (flashMethod === FlashMethod.STLink) ? selectedStlink : (selectedPort || undefined),
      usbDeviceName: (flashMethod === FlashMethod.DFU) ? selectedUSBDevice : (flashMethod === FlashMethod.STLink ? (selectedStlink?.productName || 'ST-Link') : undefined),
      baudrate: (flashMethod === FlashMethod.UART) ? 115200 : undefined,
      target: targetType === TargetType.Receiver ? BackendTarget.Receiver : BackendTarget.TxModule,
    });
  }, [firmwareFiles, selectedFile, flashMethod, selectedDevice, selectedVersion, selectedPort, selectedUSBDevice, selectedStlink, serialX, setError, onFlash, targetType, metadata]);

  const handleFlashWirelessBridge = useCallback(async () => {
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

        const file = files[0]; // Use first match

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
  }, [metadata, selectedVersion, selectedDevice, selectedPort, onFlash, targetType, setError]);

  const isDevVersion = selectedVersion?.includes('dev');
  const isFrSkyR9 = selectedDevice?.includes('FrSky R9');
  const isR9Rx = isFrSkyR9 && targetType === TargetType.Receiver;
  const isR9Tx = selectedDevice?.includes('FrSky R9') && targetType === TargetType.TxExternal;

  // Enforce allowed methods for R9 Rx/Tx
  useEffect(() => {
    if (isR9Rx) {
      if (flashMethod !== FlashMethod.STLink && flashMethod !== FlashMethod.APPassthru) {
        setFlashMethod(FlashMethod.STLink);
      }
      
      // Enforce HEX selection for R9 Rx if using STLink
      if (flashMethod === FlashMethod.STLink && firmwareFiles.length > 0) {
          const currentIsElrs = selectedFile?.toLowerCase().endsWith('.elrs');
          const currentIsHex = selectedFile?.toLowerCase().endsWith('.hex');
          
          if (!currentIsElrs && !currentIsHex) {
              const hex = firmwareFiles.find(f => f.filename.toLowerCase().endsWith('.hex'));
              if (hex) setSelectedFile(hex.filename);
          }
      }
    } else if (isR9Tx) {
       // Force STLink for R9 Tx if method is not set or default
        if (!flashMethod || flashMethod === DEFAULT_FLASH_METHOD) {
            setFlashMethod(FlashMethod.STLink);
        }
    }
  }, [isR9Rx, isR9Tx, flashMethod, firmwareFiles, selectedFile, setSelectedFile]);

  return (
    <div className="panel">
      <h2 className="panel-title">{title}</h2>
      
      {error && (
        <div className="error-box">
          <strong>❌ Error:</strong> {error}
        </div>
      )}
      
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

        {/* FILE DRIVEN UI LOGIC */}
        {(() => {
            return (
                <>
                    {/* Standard Flash Method & Port Selection */}
                        <>
                            {/* Flash Method Selection */}
                            {/* Always show for R9 Tx to confirm method, otherwise only if multiple choices exist */}
                            {(metadata?.raw_flashmethod?.includes(',') || isR9Tx) && (
                            <>
                                {(showSerialX && flashMethod === FlashMethod.APPassthru) ? (
                                    <>
                                    <div className="form-group span-2">
                                        <label>Flash Method</label>
                                        <div className="select-wrapper">
                                        <select 
                                            value={flashMethod} 
                                            onChange={(e) => setFlashMethod(e.target.value)}
                                            disabled={isFlashing}
                                        >
                                            {(metadata?.raw_flashmethod?.split(',') || []).map((m: string) => {
                                            let label = m;
                                            if (m === FlashMethod.DFU) label = 'DFU (USB)';
                                            if (m === FlashMethod.STLink) label = 'STLink (SWD)';
                                            if (m === FlashMethod.UART) label = 'SystemBoot (UART)';
                                            if (m === FlashMethod.ESPTool) label = 'ESPTool (UART)';
                                            if (m === FlashMethod.APPassthru) label = 'AP Passthru';
                                            return <option key={m} value={m}>{label}</option>;
                                            })}
                                        </select>
                                        </div>
                                    </div>
                                    
                                    <div className="form-group span-2">
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
                                                                {(metadata?.raw_flashmethod?.split(',') || [])
                                                                // Filter logic (preserve R9 strictness if desired, but conceptually just listing what's available is usually better)
                                                                .filter((m: string) => !isR9Rx || m === FlashMethod.STLink || m === FlashMethod.APPassthru)
                                                                .map((m: string) => {
                                                                let label = m;
                                                                if (m === FlashMethod.DFU) label = 'DFU (USB)';                                                                if (m === FlashMethod.STLink) label = 'STLink (SWD)';
                                                                if (m === FlashMethod.UART) label = 'SystemBoot (UART)';
                                                                if (m === FlashMethod.ESPTool) label = 'ESPTool (UART)';
                                                                if (m === FlashMethod.APPassthru) label = 'AP Passthru';
                                                                return <option key={m} value={m}>{label}</option>;
                                                                })}
                                                            </select>
                                    </div>
                                    </div>
                                )}
                            </>
                            )}

                            {/* COM Port Selection */}
                            {((flashMethod === FlashMethod.UART || flashMethod === FlashMethod.ESPTool || flashMethod === FlashMethod.APPassthru) || (metadata?.needsPort && flashMethod !== FlashMethod.DFU && flashMethod !== FlashMethod.STLink)) && (!isFrSkyR9 || (isFrSkyR9 && flashMethod === FlashMethod.APPassthru)) && (
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

                                    <div title={isFlashing ? 'Flashing in progress' : !selectedFile || firmwareFiles.length === 0 ? 'Select a firmware file first' : isLoadingFiles ? 'Loading firmware files...' : !selectedPort ? 'Select a COM port first' : undefined}>
                                      <button 
                                        className="btn-primary btn-flash"
                                        onClick={handleFlash}
                                        disabled={isFlashing || !selectedFile || firmwareFiles.length === 0 || isLoadingFiles || !selectedPort}
                                        aria-label={targetType === TargetType.Receiver ? 'Flash Receiver firmware' : 'Flash Tx Module firmware'}
                                      >
                                        {isFlashing && (flashTarget === (targetType === TargetType.Receiver ? BackendTarget.Receiver : BackendTarget.TxModule)) ? 
                                          (progress > 0 ? `Flashing... ${progress}%` : 'Flashing...') : 
                                          (targetType === TargetType.Receiver ? 'Flash Receiver' : 'Flash Tx Module')}
                                      </button>
                                    </div>

                                    {allowWirelessBridge && metadata?.hasWirelessBridge && (
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
                                    )}

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
                            )}

                            {/* USB Device Selection (DFU) */}
                            {flashMethod === FlashMethod.DFU && (
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
                                
                                <div title={isFlashing ? 'Flashing in progress' : !selectedFile || firmwareFiles.length === 0 ? 'Select a firmware file first' : isLoadingFiles ? 'Loading firmware files...' : !selectedUSBDevice ? 'Select a USB device first' : undefined}>
                                  <button 
                                    className="btn-primary btn-flash"
                                    onClick={handleFlash}
                                    disabled={isFlashing || !selectedFile || firmwareFiles.length === 0 || isLoadingFiles || !selectedUSBDevice}
                                    aria-label={targetType === TargetType.Receiver ? 'Flash Receiver firmware' : 'Flash Tx Module firmware'}
                                  >
                                    {isFlashing && (flashTarget === (targetType === TargetType.Receiver ? BackendTarget.Receiver : BackendTarget.TxModule)) ? 
                                      (progress > 0 ? `Flashing... ${progress}%` : 'Flashing...') : 
                                      (targetType === TargetType.Receiver ? 'Flash Receiver' : 'Flash Tx Module')}
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
                            )}

                            {/* ST-Link Selection */}
                            {flashMethod === FlashMethod.STLink && (
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

                                    <div title={isFlashing ? 'Flashing in progress' : !selectedFile || firmwareFiles.length === 0 ? 'Select a firmware file first' : isLoadingFiles ? 'Loading firmware files...' : !selectedStlink ? 'Select an ST-Link device first' : undefined}>
                                      <button 
                                        className="btn-primary btn-flash"
                                        onClick={handleFlash}
                                        disabled={isFlashing || !selectedFile || firmwareFiles.length === 0 || isLoadingFiles || !selectedStlink}
                                        aria-label={targetType === TargetType.Receiver ? 'Flash Receiver firmware' : 'Flash Tx Module firmware'}
                                      >
                                        {isFlashing && (flashTarget === (targetType === TargetType.Receiver ? BackendTarget.Receiver : BackendTarget.TxModule)) ? 
                                          (progress > 0 ? `Flashing... ${progress}%` : 'Flashing...') : 
                                          (targetType === TargetType.Receiver ? 'Flash Receiver' : 'Flash Tx Module')}
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
                            )}
                        </>
                    {/* ELRS Bootloader card - Show for R9 Tx */}
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

      {isDevVersion && (
        <div className="warning-box">
          <strong>⚠️ Warning:</strong> You are about to flash a 'dev' firmware version.
          Please ensure you understand the risks involved.
        </div>
      )}

      {metadata?.description && (
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
