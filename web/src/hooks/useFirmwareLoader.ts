import { useState, useEffect, useCallback, useRef, useMemo } from 'react';
import { usePersistentState } from './usePersistentState';

// last updated: 2026-03-09

import { api } from '../api/webSerialApi';
import {
  listPorts,
  requestPort,
  forgetAllPorts,
  listUSBDevices,
  requestUSBDevice,
  filterPortsByMethod,
} from '../api/hardwareService';
import type { FirmwareFile } from '../types';

/**
 * custom hook for loading firmware files and metadata
 * encapsulates shared logic used by TxModuleExternal, TxModuleInternal, and Receiver components
 */
export function useFirmwareLoader(type: string, selectedDevice: string, selectedVersion: string) {
  const [firmwareFiles, setFirmwareFiles] = useState<FirmwareFile[]>([]);
  const [selectedFile, setSelectedFile] = usePersistentState(`flasher_${type}_selectedFile`, '');
  const [metadata, setMetadata] = useState<any>(null);
  const [isLoadingFiles, setIsLoadingFiles] = useState(false);
  const [error, setError] = useState<string | null>(null);
  
  // track mounted state to prevent state updates after unmount
  const isMountedRef = useRef(true);
  
  useEffect(() => {
    isMountedRef.current = true;
    return () => { isMountedRef.current = false; };
  }, []);

  // load firmware files when device or version changes
  const loadFirmwareFiles = useCallback(async () => {
    if (!selectedDevice || !selectedVersion) return;
    
    setIsLoadingFiles(true);
    setError(null);
    
    try {
      const result = await api.listFirmware({
        type,
        device: selectedDevice,
        version: selectedVersion,
      });
      
      if (!isMountedRef.current) return;
      
      const files = result.files || [];
      setFirmwareFiles(files);
      
      if (files.length > 0) {
        // Only set default if current selected file is not in the list or is empty
        const currentFileExists = files.find((f: FirmwareFile) => f.filename === selectedFile);
        if (!selectedFile || !currentFileExists) {
            setSelectedFile(files[0].filename);
        }
      } else {
        setSelectedFile('');
      }
    } catch (err) {
      if (!isMountedRef.current) return;
      console.error('Failed to load firmware files:', err);
      setError('Failed to load firmware list. Please check your connection.');
      setFirmwareFiles([]);
      setSelectedFile('');
    } finally {
      if (isMountedRef.current) {
        setIsLoadingFiles(false);
      }
    }
  }, [type, selectedDevice, selectedVersion]);

  // load metadata when file selection changes
  const loadMetadata = useCallback(async () => {
    if (!selectedDevice || !selectedFile) {
      setMetadata(null);
      return;
    }
    
    try {
      const result = await api.getMetadata({
        type,
        device: selectedDevice,
        filename: selectedFile,
      });
      
      if (isMountedRef.current) {
        setMetadata(result);
      }
    } catch (err) {
      if (isMountedRef.current) {
        console.error('Failed to load metadata:', err);
        setMetadata(null);
      }
    }
  }, [type, selectedDevice, selectedFile]);

  // auto-load firmware files when device/version changes
  useEffect(() => {
    loadFirmwareFiles();
  }, [loadFirmwareFiles]);

  // auto-load metadata when file selection changes
  useEffect(() => {
    loadMetadata();
  }, [loadMetadata]);

  return {
    firmwareFiles,
    selectedFile,
    setSelectedFile,
    metadata,
    isLoadingFiles,
    error,
    setError,
    loadFirmwareFiles,
    loadMetadata,
  };
}

/**
 * custom hook for managing serial port selection
 * filters ports by flash method when provided
 */
export function useSerialPorts(isPaused = false, flashMethod = '', targetType = '') {
  const [ports, setPorts] = useState<string[]>([]);
  const [rawPorts, setRawPorts] = useState<SerialPort[]>([]);
  const [selectedPort, setSelectedPort] = usePersistentState('flasher_selectedPort', '');
  const [isScanningPorts, setIsScanningPorts] = useState(false);

  // track mounted state to prevent state updates after unmount
  const isMountedRef = useRef(true);
  useEffect(() => {
    isMountedRef.current = true;
    return () => { isMountedRef.current = false; };
  }, []);

  const refreshPorts = useCallback(async (options: { silent?: boolean; request?: boolean } = {}) => {
    const { silent = false, request = false } = options;
    
    if (!silent) setIsScanningPorts(true);
    
    try {
      let result;
      let newPort: string | null = null;
      if (request) {
        // trigger browser picker
        newPort = await requestPort(); 
        // then list all available ports
        result = await listPorts();
      } else {
        result = await listPorts();
      }
      
      if (!isMountedRef.current) return;
      
      const newPorts = result.ports || [];
      
      // store raw serial port objects for filtering
      if (navigator.serial) {
        const serialPorts = await navigator.serial.getPorts();
        setRawPorts(serialPorts);
      }
      
      // only update if port list actually changed to avoid unnecessary re-renders
      setPorts(prevPorts => {
        if (JSON.stringify(prevPorts) === JSON.stringify(newPorts)) {
          return prevPorts;
        }
        return newPorts;
      });
      
      // If we just added a new port, select it immediately
      if (newPort && newPorts.includes(newPort)) {
          setSelectedPort(newPort);
      }
    } catch (err) {
      console.error('Failed to list ports:', err);
    } finally {
      if (isMountedRef.current && !silent) {
        setIsScanningPorts(false);
      }
    }
  }, []);

  // initial port refresh on mount
  useEffect(() => {
    refreshPorts();
  }, [refreshPorts]);

  // auto-refresh interval and event listeners
  useEffect(() => {
    if (isPaused) return;

    const handleUpdate = () => refreshPorts({ silent: true });

    // Poll every 2s as fallback and to ensure state consistency
    const intervalId = setInterval(handleUpdate, 2000);

    // Use event listeners for reactive updates
    if (navigator.serial) {
        navigator.serial.addEventListener('connect', handleUpdate);
        navigator.serial.addEventListener('disconnect', handleUpdate);
    }

    return () => {
        clearInterval(intervalId);
        if (navigator.serial) {
            navigator.serial.removeEventListener('connect', handleUpdate);
            navigator.serial.removeEventListener('disconnect', handleUpdate);
        }
    };
  }, [refreshPorts, isPaused]);

  const forgetAll = useCallback(async () => {
      await forgetAllPorts();
      refreshPorts({ silent: true }); // Silent refresh to update list
  }, [refreshPorts]);

  // derive filter key from flash method and target type
  const filterKey = targetType === 'txint' ? 'internal' : flashMethod;

  // apply strict filtering based on flash method
  const filteredPorts = useMemo(() => {
    if (!filterKey || rawPorts.length === 0) return ports;
    return filterPortsByMethod(ports, rawPorts, filterKey);
  }, [ports, rawPorts, filterKey]);

  // if selected port is not in filtered list, auto-select first filtered port
  useEffect(() => {
    if (filteredPorts.length > 0) {
      if (!selectedPort || !filteredPorts.includes(selectedPort)) {
        // prioritize ArduPilot if available in filtered list
        const ardupilotPort = filteredPorts.find(p => p.includes('ArduPilot'));
        setSelectedPort(ardupilotPort || filteredPorts[0]);
      }
    } else if (selectedPort) {
      // clear stale selection when no ports match the current filter
      setSelectedPort('');
    }
  }, [filteredPorts, selectedPort, setSelectedPort]);

  return {
    ports: filteredPorts,
    selectedPort,
    setSelectedPort,
    isScanningPorts,
    refreshPorts,
    forgetAll,
  };
}

/**
 * custom hook for managing USB device selection (for DFU)
 */
export function useUSBDevices(_isPaused = false) {
  const [_usbDevices, setUsbDevices] = useState<string[]>([]);
  const [selectedUSBDevice, setSelectedUSBDevice] = usePersistentState('flasher_selectedUSBDevice', '');
  const [isScanningUSB, setIsScanningUSB] = useState(false);

  // track mounted state
  const isMountedRef = useRef(true);
  useEffect(() => {
    isMountedRef.current = true;
    return () => { isMountedRef.current = false; };
  }, []);

  const refreshUSBDevices = useCallback(async (options: { request?: boolean } = {}) => {
    const { request = false } = options;
    
    if (request) setIsScanningUSB(true);
    
    try {
      let result;
      if (request) {
        const name = await requestUSBDevice();
        result = await listUSBDevices();
        if (name && isMountedRef.current) {
          setSelectedUSBDevice(name);
        }
      } else {
        result = await listUSBDevices();
      }
      
      if (!isMountedRef.current) return;
      
      const newDevices = result.devices || [];
      setUsbDevices(newDevices);
      
      if (newDevices.length > 0 && !selectedUSBDevice) {
        setSelectedUSBDevice(newDevices[0]);
      }
    } catch (err) {
      console.error('Failed to list USB devices:', err);
    } finally {
      if (isMountedRef.current) {
        setIsScanningUSB(false);
      }
    }
  }, []);

  // initial refresh
  useEffect(() => {
    refreshUSBDevices();
  }, [refreshUSBDevices]);

  return {
    usbDevices: _usbDevices,
    selectedUSBDevice,
    setSelectedUSBDevice,
    isScanningUSB,
    refreshUSBDevices,
  };
}

/**
 * custom hook for managing default selections
 */
export function useDefaultSelection(items: any[], currentValue: any, setValue: (val: any) => void, extractValue = (item: any) => item) {
  useEffect(() => {
    if (items.length > 0 && !currentValue) {
      setValue(extractValue(items[0]));
    }
  }, [items, currentValue, setValue, extractValue]);
}
