import { useState, useEffect, useCallback, useRef } from 'react';
import { api } from '../api/webSerialApi';
import type { FirmwareFile } from '../types';

/**
 * custom hook for loading firmware files and metadata
 * encapsulates shared logic used by TxModuleExternal, TxModuleInternal, and Receiver components
 */
export function useFirmwareLoader(type: string, selectedDevice: string, selectedVersion: string) {
  const [firmwareFiles, setFirmwareFiles] = useState<FirmwareFile[]>([]);
  const [selectedFile, setSelectedFile] = useState('');
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
        setSelectedFile(files[0].filename);
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
 */
export function useSerialPorts(isPaused = false) {
  const [ports, setPorts] = useState<string[]>([]);
  const [selectedPort, setSelectedPort] = useState('');
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
      if (request) {
        // Trigger browser picker
        await api.requestPort(); 
        // Then list all available ports
        result = await api.listPorts();
      } else {
        result = await api.listPorts();
      }
      
      if (!isMountedRef.current) return;
      
      const newPorts = result.ports || [];
      
      // only update if port list actually changed to avoid unnecessary re-renders
      setPorts(prevPorts => {
        if (JSON.stringify(prevPorts) === JSON.stringify(newPorts)) {
          return prevPorts;
        }
        return newPorts;
      });
      
      // if selected port is no longer available, select first available
      setSelectedPort(prevSelected => {
        if (prevSelected && !newPorts.includes(prevSelected)) {
          return newPorts.length > 0 ? newPorts[0] : '';
        } else if (newPorts.length > 0 && !prevSelected) {
          return newPorts[0];
        }
        return prevSelected;
      });
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

  // auto-refresh interval
  useEffect(() => {
    if (isPaused) return;

    const intervalId = setInterval(() => {
      refreshPorts({ silent: true });
    }, 2000); // refresh every 2 seconds

    return () => clearInterval(intervalId);
  }, [refreshPorts, isPaused]);

  return {
    ports,
    selectedPort,
    setSelectedPort,
    isScanningPorts,
    refreshPorts,
  };
}

/**
 * custom hook for managing USB device selection (for DFU)
 */
export function useUSBDevices(_isPaused = false) {
  const [_usbDevices, setUsbDevices] = useState<string[]>([]);
  const [selectedUSBDevice, setSelectedUSBDevice] = useState('');
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
        const name = await api.requestUSBDevice();
        result = await api.listUSBDevices();
        if (name && isMountedRef.current) {
          setSelectedUSBDevice(name);
        }
      } else {
        result = await api.listUSBDevices();
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
