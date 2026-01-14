// swd debug/test page for st-link validation
// date: 2026-01-14

import { useState, useCallback, useRef } from 'react';
import { Usb, RefreshCw, Zap, Info, CheckCircle, XCircle, AlertCircle, Upload, HardDrive } from 'lucide-react';
import type { StlinkVersion, ChipInfo } from '../api/stlink';
import {
  StlinkDevice,
  requestStlinkDevice,
  getPairedStlinkDevices,
  TargetState,
  formatChipId,
  FlashOperations,
} from '../api/stlink';
import { parseHex } from '../api/hexParser';
import './swdTest.css';

interface LogItem {
  type: 'info' | 'success' | 'error' | 'warn';
  message: string;
  timestamp: string;
}

// helper to get target state name from value
function getTargetStateName(state: TargetState): string {
  const entry = Object.entries(TargetState).find(([, v]) => v === state);
  return entry ? entry[0] : 'Unknown';
}

function SwdTest() {
  const [logs, setLogs] = useState<LogItem[]>([]);
  const [device, setDevice] = useState<StlinkDevice | null>(null);
  const [usbDevice, setUsbDevice] = useState<USBDevice | null>(null);
  const [isConnected, setIsConnected] = useState(false);
  const [isConnecting, setIsConnecting] = useState(false);
  const [version, setVersion] = useState<StlinkVersion | null>(null);
  const [chipInfo, setChipInfo] = useState<ChipInfo | null>(null);
  const [flashSize, setFlashSize] = useState(0);
  const [chipId, setChipId] = useState(0);
  const [voltage, setVoltage] = useState(0);
  const [targetState, setTargetState] = useState<TargetState>(TargetState.Unknown);
  
  // firmware flashing state
  const [firmwareFile, setFirmwareFile] = useState<File | null>(null);
  const [firmwareData, setFirmwareData] = useState<Uint8Array | null>(null);
  const [firmwareAddress, setFirmwareAddress] = useState(0x08000000);
  const [isFlashing, setIsFlashing] = useState(false);
  const [flashProgress, setFlashProgress] = useState(0);
  const [flashStatus, setFlashStatus] = useState('');
  const fileInputRef = useRef<HTMLInputElement>(null);

  const addLog = useCallback((type: LogItem['type'], message: string) => {
    const timestamp = new Date().toLocaleTimeString();
    setLogs(prev => [...prev.slice(-100), { type, message, timestamp }]);
  }, []);

  const clearLogs = useCallback(() => {
    setLogs([]);
  }, []);

  const log = useCallback((level: string, message: string) => {
    const type = level === 'error' ? 'error' : level === 'warn' ? 'warn' : level === 'info' ? 'info' : 'info';
    addLog(type as LogItem['type'], message);
  }, [addLog]);

  // request usb device from user
  const handleRequestDevice = useCallback(async () => {
    addLog('info', 'Requesting ST-Link device...');
    try {
      const usb = await requestStlinkDevice();
      if (usb) {
        setUsbDevice(usb);
        addLog('success', `Device selected: ${usb.productName || 'ST-Link'}`);
      } else {
        addLog('warn', 'No device selected');
      }
    } catch (err) {
      addLog('error', `Failed to request device: ${err}`);
    }
  }, [addLog]);

  // check for already paired devices
  const handleCheckPaired = useCallback(async () => {
    addLog('info', 'Checking for paired ST-Link devices...');
    try {
      const devices = await getPairedStlinkDevices();
      if (devices.length > 0) {
        addLog('success', `Found ${devices.length} paired device(s)`);
        devices.forEach((d, i) => {
          addLog('info', `  ${i + 1}. ${d.productName || 'ST-Link'} (VID:${d.vendorId.toString(16)} PID:${d.productId.toString(16)})`);
        });
        // use first device
        setUsbDevice(devices[0]);
      } else {
        addLog('warn', 'No paired devices found. Click "Select Device" to pair one.');
      }
    } catch (err) {
      addLog('error', `Failed to check devices: ${err}`);
    }
  }, [addLog]);

  // connect to st-link and target
  const handleConnect = useCallback(async () => {
    if (!usbDevice) {
      addLog('error', 'No USB device selected');
      return;
    }

    setIsConnecting(true);
    addLog('info', 'Connecting to ST-Link...');

    try {
      const stlink = new StlinkDevice(usbDevice, log);
      await stlink.connect();

      setDevice(stlink);
      setIsConnected(true);
      setVersion(stlink.version);
      setChipInfo(stlink.chipInfo);
      setFlashSize(stlink.flashSize);
      setChipId(stlink.chipId);

      // get voltage
      const v = await stlink.getTargetVoltage();
      setVoltage(v);

      // get target state
      const state = await stlink.getStatus();
      setTargetState(state);

      addLog('success', 'Connected successfully!');
    } catch (err) {
      addLog('error', `Connection failed: ${err}`);
      setIsConnected(false);
    } finally {
      setIsConnecting(false);
    }
  }, [usbDevice, log, addLog]);

  // disconnect from device
  const handleDisconnect = useCallback(async () => {
    if (device) {
      addLog('info', 'Disconnecting...');
      try {
        await device.disconnect();
        addLog('success', 'Disconnected');
      } catch (err) {
        addLog('warn', `Disconnect error: ${err}`);
      }
    }
    setDevice(null);
    setIsConnected(false);
    setVersion(null);
    setChipInfo(null);
    setFlashSize(0);
    setChipId(0);
    setVoltage(0);
    setTargetState(TargetState.Unknown);
  }, [device, addLog]);

  // halt cpu
  const handleHalt = useCallback(async () => {
    if (!device) return;
    addLog('info', 'Halting CPU...');
    try {
      await device.halt();
      const state = await device.getStatus();
      setTargetState(state);
      addLog('success', 'CPU halted');
    } catch (err) {
      addLog('error', `Halt failed: ${err}`);
    }
  }, [device, addLog]);

  // run cpu
  const handleRun = useCallback(async () => {
    if (!device) return;
    addLog('info', 'Running CPU...');
    try {
      await device.run();
      const state = await device.getStatus();
      setTargetState(state);
      addLog('success', 'CPU running');
    } catch (err) {
      addLog('error', `Run failed: ${err}`);
    }
  }, [device, addLog]);

  // reset target
  const handleReset = useCallback(async () => {
    if (!device) return;
    addLog('info', 'Resetting target...');
    try {
      await device.reset();
      await device.run();
      const state = await device.getStatus();
      setTargetState(state);
      addLog('success', 'Target reset');
    } catch (err) {
      addLog('error', `Reset failed: ${err}`);
    }
  }, [device, addLog]);

  // read memory test
  const handleReadMemory = useCallback(async () => {
    if (!device) return;
    addLog('info', 'Reading first 64 bytes of flash...');
    try {
      const data = await device.readMem32(0x08000000, 64);
      const hex = Array.from(data.slice(0, 32))
        .map(b => b.toString(16).padStart(2, '0'))
        .join(' ');
      addLog('info', `Flash[0x08000000]: ${hex} ...`);
      addLog('success', 'Memory read successful');
    } catch (err) {
      addLog('error', `Memory read failed: ${err}`);
    }
  }, [device, addLog]);

  // refresh status
  const handleRefreshStatus = useCallback(async () => {
    if (!device) return;
    try {
      const state = await device.getStatus();
      setTargetState(state);
      const v = await device.getTargetVoltage();
      setVoltage(v);
      addLog('info', `Status: ${getTargetStateName(state)}, Voltage: ${v.toFixed(2)}V`);
    } catch (err) {
      addLog('error', `Status refresh failed: ${err}`);
    }
  }, [device, addLog]);

  // handle file selection
  const handleFileSelect = useCallback(async (event: React.ChangeEvent<HTMLInputElement>) => {
    const file = event.target.files?.[0];
    if (!file) return;

    setFirmwareFile(file);
    addLog('info', `Selected file: ${file.name} (${file.size} bytes)`);

    try {
      const buffer = await file.arrayBuffer();
      const filename = file.name.toLowerCase();

      if (filename.endsWith('.hex')) {
        // parse intel hex
        const hexText = new TextDecoder().decode(buffer);
        const blocks = parseHex(hexText);
        
        if (blocks.length === 0) {
          throw new Error('No data found in HEX file');
        }

        // use first block's address
        setFirmwareAddress(blocks[0].address);
        
        // combine all blocks into contiguous data
        // for simplicity, assume blocks are contiguous or use first block
        if (blocks.length === 1) {
          setFirmwareData(blocks[0].data);
          addLog('success', `HEX parsed: ${blocks[0].data.length} bytes at 0x${blocks[0].address.toString(16)}`);
        } else {
          // multiple blocks - combine them
          const startAddr = blocks[0].address;
          const lastBlock = blocks[blocks.length - 1];
          const endAddr = lastBlock.address + lastBlock.data.length;
          const totalLen = endAddr - startAddr;
          
          const combined = new Uint8Array(totalLen);
          combined.fill(0xff); // pad with erased value
          
          for (const block of blocks) {
            const offset = block.address - startAddr;
            combined.set(block.data, offset);
          }
          
          setFirmwareData(combined);
          addLog('success', `HEX parsed: ${combined.length} bytes at 0x${startAddr.toString(16)} (${blocks.length} blocks)`);
        }
      } else if (filename.endsWith('.bin')) {
        // binary file - assume 0x08000000
        setFirmwareData(new Uint8Array(buffer));
        setFirmwareAddress(0x08000000);
        addLog('success', `Binary loaded: ${buffer.byteLength} bytes`);
      } else if (filename.endsWith('.elf')) {
        addLog('error', 'ELF files not yet supported. Please use HEX or BIN format.');
        setFirmwareFile(null);
        return;
      } else {
        addLog('warn', 'Unknown file format. Treating as binary.');
        setFirmwareData(new Uint8Array(buffer));
        setFirmwareAddress(0x08000000);
      }
    } catch (err) {
      addLog('error', `Failed to parse file: ${err}`);
      setFirmwareFile(null);
      setFirmwareData(null);
    }
  }, [addLog]);

  // flash firmware
  const handleFlash = useCallback(async () => {
    if (!device || !firmwareData || !chipInfo) {
      addLog('error', 'Device not connected or no firmware loaded');
      return;
    }

    setIsFlashing(true);
    setFlashProgress(0);
    setFlashStatus('Starting...');
    addLog('info', `Starting flash: ${firmwareData.length} bytes at 0x${firmwareAddress.toString(16)}`);

    try {
      const flashOps = new FlashOperations(device, log);
      
      await flashOps.flashFirmware(
        firmwareAddress,
        firmwareData,
        chipInfo.flashPageSize,
        (percent, status) => {
          setFlashProgress(percent);
          setFlashStatus(status);
        }
      );

      addLog('success', 'Flash complete!');
      setFlashStatus('Complete!');
      
      // refresh status
      const state = await device.getStatus();
      setTargetState(state);
    } catch (err) {
      addLog('error', `Flash failed: ${err}`);
      setFlashStatus(`Error: ${err}`);
    } finally {
      setIsFlashing(false);
    }
  }, [device, firmwareData, firmwareAddress, chipInfo, log, addLog]);

  return (
    <div className="swd-test">
      <div className="swd-test-header">
        <h2><Usb size={24} /> SWD Debug Test</h2>
        <p>Step-by-step validation of ST-Link WebUSB communication</p>
      </div>

      <div className="swd-test-content">
        {/* device selection */}
        <section className="swd-section">
          <h3>1. Device Selection</h3>
          <div className="swd-buttons">
            <button onClick={handleCheckPaired} disabled={isConnected}>
              <RefreshCw size={16} /> Check Paired Devices
            </button>
            <button onClick={handleRequestDevice} disabled={isConnected}>
              <Usb size={16} /> Select Device
            </button>
          </div>
          {usbDevice && (
            <div className="swd-info-box">
              <strong>Selected:</strong> {usbDevice.productName || 'ST-Link'}
              <br />
              <span className="swd-detail">
                VID: 0x{usbDevice.vendorId.toString(16).padStart(4, '0')} &nbsp;
                PID: 0x{usbDevice.productId.toString(16).padStart(4, '0')}
              </span>
            </div>
          )}
        </section>

        {/* connection */}
        <section className="swd-section">
          <h3>2. Connection</h3>
          <div className="swd-buttons">
            {!isConnected ? (
              <button 
                onClick={handleConnect} 
                disabled={!usbDevice || isConnecting}
                className="primary"
              >
                <Zap size={16} /> {isConnecting ? 'Connecting...' : 'Connect'}
              </button>
            ) : (
              <button onClick={handleDisconnect} className="danger">
                Disconnect
              </button>
            )}
          </div>
        </section>

        {/* device info */}
        {isConnected && (
          <section className="swd-section">
            <h3>3. Device Information</h3>
            <div className="swd-info-grid">
              <div className="swd-info-item">
                <label>ST-Link</label>
                <span>V{version?.stlinkV} (JTAG:{version?.jtagV} API:{version?.apiVersion})</span>
              </div>
              <div className="swd-info-item">
                <label>Target Chip</label>
                <span>{chipInfo ? formatChipId(chipId) : `Unknown (0x${chipId.toString(16)})`}</span>
              </div>
              <div className="swd-info-item">
                <label>Flash Size</label>
                <span>{flashSize > 0 ? `${flashSize / 1024} KB` : 'Unknown'}</span>
              </div>
              <div className="swd-info-item">
                <label>SRAM Size</label>
                <span>{chipInfo ? `${chipInfo.sramSize / 1024} KB` : 'Unknown'}</span>
              </div>
              <div className="swd-info-item">
                <label>Target Voltage</label>
                <span>{voltage > 0 ? `${voltage.toFixed(2)}V` : 'N/A'}</span>
              </div>
              <div className="swd-info-item">
                <label>CPU State</label>
                <span className={`state-${getTargetStateName(targetState).toLowerCase()}`}>
                  {getTargetStateName(targetState)}
                </span>
              </div>
            </div>
          </section>
        )}

        {/* target control */}
        {isConnected && (
          <section className="swd-section">
            <h3>4. Target Control</h3>
            <div className="swd-buttons">
              <button onClick={handleHalt}>Halt</button>
              <button onClick={handleRun}>Run</button>
              <button onClick={handleReset}>Reset</button>
              <button onClick={handleRefreshStatus}>
                <RefreshCw size={16} /> Refresh
              </button>
            </div>
          </section>
        )}

        {/* memory access */}
        {isConnected && (
          <section className="swd-section">
            <h3>5. Memory Access Test</h3>
            <div className="swd-buttons">
              <button onClick={handleReadMemory}>Read Flash (0x08000000)</button>
            </div>
          </section>
        )}

        {/* firmware flash */}
        {isConnected && (
          <section className="swd-section">
            <h3>6. Firmware Flash</h3>
            <div className="swd-firmware-section">
              <input
                type="file"
                ref={fileInputRef}
                onChange={handleFileSelect}
                accept=".hex,.bin,.elf"
                style={{ display: 'none' }}
              />
              <div className="swd-buttons">
                <button onClick={() => fileInputRef.current?.click()} disabled={isFlashing}>
                  <Upload size={16} /> Select Firmware
                </button>
                <button 
                  onClick={handleFlash} 
                  disabled={!firmwareData || isFlashing}
                  className="primary"
                >
                  <HardDrive size={16} /> {isFlashing ? 'Flashing...' : 'Flash Firmware'}
                </button>
              </div>
              
              {firmwareFile && (
                <div className="swd-info-box">
                  <strong>File:</strong> {firmwareFile.name}<br />
                  <span className="swd-detail">
                    Size: {firmwareData?.length || 0} bytes | 
                    Address: 0x{firmwareAddress.toString(16)}
                  </span>
                </div>
              )}
              
              {isFlashing && (
                <div className="swd-progress">
                  <div className="swd-progress-bar">
                    <div 
                      className="swd-progress-fill" 
                      style={{ width: `${flashProgress}%` }}
                    />
                  </div>
                  <span className="swd-progress-text">{flashProgress}% - {flashStatus}</span>
                </div>
              )}
            </div>
          </section>
        )}

        {/* log output */}
        <section className="swd-section swd-log-section">
          <div className="swd-log-header">
            <h3>Log Output</h3>
            <button onClick={clearLogs} className="small">Clear</button>
          </div>
          <div className="swd-log">
            {logs.length === 0 && (
              <div className="swd-log-empty">Click "Check Paired Devices" or "Select Device" to begin</div>
            )}
            {logs.map((log, i) => (
              <div key={i} className={`swd-log-item ${log.type}`}>
                <span className="swd-log-time">{log.timestamp}</span>
                <span className="swd-log-icon">
                  {log.type === 'success' && <CheckCircle size={14} />}
                  {log.type === 'error' && <XCircle size={14} />}
                  {log.type === 'warn' && <AlertCircle size={14} />}
                  {log.type === 'info' && <Info size={14} />}
                </span>
                <span className="swd-log-msg">{log.message}</span>
              </div>
            ))}
          </div>
        </section>
      </div>
    </div>
  );
}

export default SwdTest;
