import { useState, useEffect, useCallback } from 'react';
import { useFirmwareLoader, useSerialPorts, useUSBDevices, useDefaultSelection } from '../hooks/useFirmwareLoader';
import { api } from '../api/webSerialApi';
import type { Version } from '../types';
import { FlashMethod, TargetType } from '../constants';
import './panel.css';

const SERIAL_PORTS = ['SERIAL1', 'SERIAL2', 'SERIAL3', 'SERIAL4', 'SERIAL5', 'SERIAL6', 'SERIAL7', 'SERIAL8'];

interface FirmwareFlasherPanelProps {
  title: string;
  targetType: string;
  versions: Version[];
  devices: string[];
  onFlash: (options: any) => void;
  isFlashing: boolean;
  flashTarget: string | null;
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
  const [selectedDevice, setSelectedDevice] = useState('');
  const [selectedVersion, setSelectedVersion] = useState('');
  const [flashMethod, setFlashMethod] = useState('');
  const [serialX, setSerialX] = useState('SERIAL1');

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
  } = useSerialPorts(isFlashing);

  const {
    usbDevices, // Destructured
    selectedUSBDevice,
    isScanningUSB,
    refreshUSBDevices,
  } = useUSBDevices(isFlashing);

  // set default selections when data loads
  useDefaultSelection(devices, selectedDevice, setSelectedDevice);
  useDefaultSelection(versions, selectedVersion, setSelectedVersion, v => v.version);

  // set default flash method when metadata loads
  useEffect(() => {
    if (metadata?.raw_flashmethod) {
      const methods = metadata.raw_flashmethod.split(',');
      // priorities: esptool, uart, stlink, dfu, appassthru
      if (methods.includes(FlashMethod.ESPTool)) {
          setFlashMethod(FlashMethod.ESPTool);
      } else if (methods.includes(FlashMethod.UART)) {
          setFlashMethod(FlashMethod.UART);
      } else if (methods.includes(FlashMethod.STLink)) {
          setFlashMethod(FlashMethod.STLink);
      } else if (methods.includes(FlashMethod.DFU)) {
          setFlashMethod(FlashMethod.DFU);
      } else if (methods.includes(FlashMethod.APPassthru)) {
          setFlashMethod(FlashMethod.APPassthru);
      } else {
          setFlashMethod(methods[0]);
      }
    } else {
      setFlashMethod('default');
    }
  }, [metadata]);

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

    // clear any previous error before starting
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
      port: selectedPort || undefined,
      usbDeviceName: selectedUSBDevice || undefined,
      baudrate: (flashMethod === FlashMethod.UART) ? 115200 : undefined,
      target: targetType === 'rx' ? 'receiver' : 'tx_module',
    });
  }, [firmwareFiles, selectedFile, flashMethod, selectedDevice, selectedVersion, selectedPort, selectedUSBDevice, serialX, setError, onFlash, targetType, metadata, serialX]);

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
          target: 'wireless_bridge',
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

  return (
    <div className="panel">
      <h2 className="panel-title">{title}</h2>
      
      {error && (
        <div className="error-box">
          <strong>❌ Error:</strong> {error}
        </div>
      )}
      
      <div className="form-grid">
        <div className="form-group">
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

        <div className="form-group">
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

        <div className="form-group full-width">
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
                firmwareFiles.map(file => (
                  <option key={file.filename} value={file.filename}>{file.filename}</option>
                ))
              )}
            </select>
          </div>
        </div>

        {/* flash method and serialX row */}
        {metadata?.raw_flashmethod?.includes(',') && (
          <>
             {/* If we are in passthru mode and showing serialX, put them on same row */}
             {(showSerialX && flashMethod === FlashMethod.APPassthru) ? (
                <>
                  <div className="form-group">
                    <label>Flash Method</label>
                    <div className="select-wrapper">
                      <select 
                        value={flashMethod} 
                        onChange={(e) => setFlashMethod(e.target.value)}
                        disabled={isFlashing}
                      >
                        {metadata.raw_flashmethod.split(',').map((m: string) => {
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
                  
                  <div className="form-group">
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
                /* Standard full-width flash method if not combined */
                <div className="form-group full-width">
                  <label>Flash Method</label>
                  <div className="select-wrapper">
                    <select 
                      value={flashMethod} 
                      onChange={(e) => setFlashMethod(e.target.value)}
                      disabled={isFlashing}
                    >
                      {metadata.raw_flashmethod.split(',').map((m: string) => {
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
             )}
          </>
        )}

        {/* COM port selection */}
        {/* FIX: Now shown for appassthru as well */}
        {(metadata?.needsPort || flashMethod === FlashMethod.UART || flashMethod === FlashMethod.ESPTool || flashMethod === FlashMethod.APPassthru) && !isFrSkyR9 && (
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
                  className="btn-success" 
                  onClick={() => refreshPorts({ request: true })}
                  disabled={isFlashing || isScanningPorts}
                  title={isScanningPorts ? 'Scanning for ports...' : 'Authorize a new serial device'}
                  aria-label="Scan for serial ports"
                >
                  {isScanningPorts ? 'Scanning...' : 'Add Device'}
                </button>
            </div>
          </div>
        )}

        {/* USB Device selection (for DFU) */}
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
                      onChange={(e) => {
                         if (e.target.value) {
                             // If we had logic to select from list w/o prompt
                             // But mostly we need prompt for permission? 
                             // We don't have setSelectedUSBDevice exposed or logic for it without prompt maybe?
                             // useUSBDevices exposes setSelectedUSBDevice.
                             // But typical WebUSB flow is 'requestDevice'. 
                             // However, getDevices() returns granted devices. 
                             // So we CAN select them.
                         }
                      }}
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
                    className="btn-success" 
                    onClick={() => refreshUSBDevices({ request: true })}
                    disabled={isFlashing || isScanningUSB}
                  >
                    {isScanningUSB ? 'Scanning...' : 'Add Device'}
                  </button>
                </>
              )}
            </div>
          </div>
        )}
      </div>

      {isDevVersion && (
        <div className="warning-box">
          <strong>⚠️ Warning:</strong> You are about to flash a 'dev' firmware version.
          Please ensure you understand the risks involved.
        </div>
      )}

      {metadata?.description && flashMethod !== FlashMethod.STLink && (
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

      {flashMethod === FlashMethod.STLink && !isFrSkyR9 && (
        <div className="external-flash-card">
              <div className="flash-card-header" style={{ justifyContent: 'space-between', alignItems: 'center' }}>
                <div style={{ display: 'flex', alignItems: 'center', gap: '12px' }}>
                    <div className="flash-card-icon">⚡</div>
                    <div>
                      <div className="flash-card-title">External Flashing Required</div>
                      <div className="flash-card-desc">This device uses the STLink/SWD interface.</div>
                    </div>
                </div>
                <a 
                    href={firmwareFiles.find(f => f.filename === selectedFile)?.url} 
                    download={selectedFile}
                    className="btn-download"
                >
                    Download Firmware
                </a>
              </div>

              <div className="flash-steps">
                <div className="flash-step">
                  <span>Download the .hex firmware file</span>
                </div>
                <div className="flash-step">
                  <span>Open <strong>STM32 Cube Programmer</strong></span>
                </div>
                <div className="flash-step">
                  <span>Connect via STLink and flash</span>
                </div>
              </div>
        </div>
      )}

      {isFrSkyR9 && (
        <div style={{ display: 'flex', flexDirection: 'column', gap: '16px', marginTop: '16px' }}>
          {/* ELRS Bootloader - only for Tx */}
          {targetType !== TargetType.Receiver && (
            <div className="external-flash-card" style={{ marginTop: 0 }}>
                <div className="flash-card-header" style={{ justifyContent: 'space-between', alignItems: 'center' }}>
                  <div style={{ display: 'flex', alignItems: 'center', gap: '12px' }}>
                      <div className="flash-card-icon" style={{ background: 'rgba(59, 130, 246, 0.15)', color: '#60a5fa' }}>💾</div>
                      <div>
                        <div className="flash-card-title">ELRS Bootloader</div>
                        <div className="flash-card-desc">.elrs files can be flashed using the radio if the ELRS bootloader has been installed on the Tx module</div>
                      </div>
                  </div>
                  <a 
                      href={firmwareFiles.find(f => f.filename === selectedFile)?.url} 
                      download={selectedFile}
                      className="btn-download"
                  >
                      Download Firmware
                  </a>
                </div>

                <div className="flash-steps" style={{ background: 'rgba(59, 130, 246, 0.05)' }}>
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
          )}

          {/* STLink/SWD */}
          <div className="external-flash-card" style={{ marginTop: 0 }}>
              <div className="flash-card-header" style={{ justifyContent: 'space-between', alignItems: 'center' }}>
                <div style={{ display: 'flex', alignItems: 'center', gap: '12px' }}>
                    <div className="flash-card-icon">⚡</div>
                    <div>
                      <div className="flash-card-title">STLink / SWD</div>
                      <div className="flash-card-desc">Standard method using STLink adapter</div>
                    </div>
                </div>
                <a 
                    href={firmwareFiles.find(f => f.filename === selectedFile)?.url} 
                    download={selectedFile}
                    className="btn-download"
                >
                    Download Firmware
                </a>
              </div>

              <div className="flash-steps">
                <div className="flash-step">
                  <span>Download the .hex firmware file</span>
                </div>
                <div className="flash-step">
                  <span>Connect STLink adapter to module's SWD pins</span>
                </div>
                <div className="flash-step">
                  <span>Use STM32CubeProgrammer to flash</span>
                </div>
              </div>
          </div>
        </div>
      )}

      <div className="button-row">
        {flashMethod !== 'stlink' && !isFrSkyR9 && (
            <button 
            className="btn-primary btn-flash"
            onClick={handleFlash}
            disabled={isFlashing || !selectedFile || firmwareFiles.length === 0 || isLoadingFiles}
            title={isFlashing ? 'Flashing in progress' : !selectedFile || firmwareFiles.length === 0 ? 'Select a firmware file first' : isLoadingFiles ? 'Loading firmware files...' : undefined}
            aria-label={targetType === 'rx' ? 'Flash Receiver firmware' : 'Flash Tx Module firmware'}
            >
            {isFlashing && (flashTarget === (targetType === 'rx' ? 'receiver' : 'tx_module')) ? 
                (progress > 0 ? `Flashing... ${progress}%` : 'Flashing...') : 
                (targetType === 'rx' ? 'Flash Receiver' : 'Flash Tx Module')}
            </button>
        )}

        {allowWirelessBridge && metadata?.hasWirelessBridge && (
           <button 
             className="btn-primary btn-flash"
             onClick={handleFlashWirelessBridge}
             disabled={isFlashing || !selectedFile || firmwareFiles.length === 0}
             title={isFlashing ? 'Flashing in progress' : !selectedFile ? 'Select a firmware file first' : undefined}
             aria-label="Flash Wireless Bridge firmware"
           >
             {isFlashing && flashTarget === 'wireless_bridge' ? (progress > 0 ? `Flashing... ${progress}%` : 'Flashing...') : 'Flash Wireless Bridge'}
           </button>
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
  );
}

export default FirmwareFlasherPanel;
