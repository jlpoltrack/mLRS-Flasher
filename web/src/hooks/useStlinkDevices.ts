import { useState, useEffect, useCallback } from 'react';
import { requestStlinkDevice, getPairedStlinkDevices } from '../api/stlink';

export function useStlinkDevices() {
  const [stlinkDevices, setStlinkDevices] = useState<USBDevice[]>([]);
  const [selectedStlink, setSelectedStlink] = useState<USBDevice | null>(null);
  const [isScanningStlink, setIsScanningStlink] = useState(false);

  // Refresh list of paired devices
  const refreshStlinks = useCallback(async (options: { request?: boolean } = {}) => {
    setIsScanningStlink(true);
    try {
      if (options.request) {
        const device = await requestStlinkDevice();
        if (device) {
          // If user selected a device, update list and select it
          const paired = await getPairedStlinkDevices();
          setStlinkDevices(paired);
          setSelectedStlink(device);
        }
      } else {
        // Just refresh list
        const paired = await getPairedStlinkDevices();
        setStlinkDevices(paired);
        // If current selection is still in list, keep it; else select first or null
        if (selectedStlink) {
           const exists = paired.find(d => d.serialNumber === selectedStlink.serialNumber);
           if (!exists) setSelectedStlink(paired.length > 0 ? paired[0] : null);
        } else if (paired.length > 0) {
           setSelectedStlink(paired[0]);
        }
      }
    } catch (err) {
      console.error('Error scanning ST-Link devices:', err);
    } finally {
      setIsScanningStlink(false);
    }
  }, [selectedStlink]);

  // Initial load
  useEffect(() => {
    refreshStlinks();
    
    // Listen for connect/disconnect events
    const handleConnect = () => refreshStlinks();
    const handleDisconnect = () => refreshStlinks();
    
    if (navigator.usb) {
      navigator.usb.addEventListener('connect', handleConnect);
      navigator.usb.addEventListener('disconnect', handleDisconnect);
    }
    
    return () => {
      if (navigator.usb) {
        navigator.usb.removeEventListener('connect', handleConnect);
        navigator.usb.removeEventListener('disconnect', handleDisconnect);
      }
    };
  }, []); // eslint-disable-line react-hooks/exhaustive-deps

  return {
    stlinkDevices,
    selectedStlink,
    setSelectedStlink,
    isScanningStlink,
    refreshStlinks
  };
}
