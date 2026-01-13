import { useState, useEffect, useCallback, useRef } from 'react';
import Navigation from './components/Navigation';
import DeviceView from './components/DeviceView';
import LuaScript from './components/LuaScript';
import Console from './components/Console';
import UpdateBanner from './components/UpdateBanner';
import { TargetType, LogType } from './constants';
import './styles/app.css';
import { api } from './api/webSerialApi';
import type { LogEntry, Version } from './types';


function App() {
  const [activeTab, setActiveTab] = useState('tx_ext');
  const [logs, setLogs] = useState<LogEntry[]>([]);
  const [versions, setVersions] = useState<Version[]>([]);
  const [devices, setDevices] = useState<{ tx: string[], rx: string[], txint: string[] }>({ tx: [], rx: [], txint: [] });
  const [isLoading, setIsLoading] = useState(true);
  const [isFlashing, setIsFlashing] = useState(false);
  const [flashTarget, setFlashTarget] = useState<string | null>(null);
  const [progress, setProgress] = useState(0);
  const [updateInfo, setUpdateInfo] = useState<{ latestVersion: string; releaseUrl: string; updateAvailable: boolean } | null>(null);

  const hasLoaded = useRef(false);

  const addLog = useCallback((entry: LogEntry) => {
    const timestamp = new Date().toLocaleTimeString();
    setLogs(prev => [...prev.slice(-200), { ...entry, timestamp }]); // keep last 200 entries
  }, []);

  // load initial data on mount
  useEffect(() => {
    console.log(`%cmLRS Flasher v${__APP_VERSION__}`, 'color: #3b82f6; font-weight: bold; font-size: 1.2em;');
    
    async function loadInitialData() {
      if (hasLoaded.current) return;
      hasLoaded.current = true;

      try {
        addLog({ type: LogType.Info, message: 'Downloading metadata from GitHub...' });
        
        const versionsResult = await api.listVersions();
        const loadedVersions = versionsResult.versions || [];
        setVersions(loadedVersions as Version[]);
        
        const [txDevices, rxDevices, txintDevices] = await Promise.all([
          api.listDevices('tx'),
          api.listDevices('rx'),
          api.listDevices('txint'),
        ]);
        
        setDevices({
          tx: txDevices.devices || [],
          rx: rxDevices.devices || [],
          txint: txintDevices.devices || [],
        });
        
        if (loadedVersions.length === 0) {
          addLog({ type: LogType.Error, message: 'No firmware versions found.' });
        } else {
          addLog({ type: LogType.Info, message: 'Metadata loaded successfully' });
        }
      } catch (err: any) {
        addLog({ type: LogType.Error, message: `Failed to load metadata: ${err.message || err}` });
      } finally {
        setIsLoading(false);
      }
    }
    

    // check for updates
    async function checkUpdates() {
      try {
        const update = await api.checkForUpdates();
        if (update && update.updateAvailable) {
          setUpdateInfo(update);
        }
      } catch (err) {
        console.error('Failed to check for updates:', err);
      }
    }

    loadInitialData();
    checkUpdates();
  }, [addLog]);

  // listen for python output
  useEffect(() => {
    const cleanup = api.onOutput((data: any) => {
      if (data.type === 'progress') {
        setProgress(data.progress);
      } else {
        addLog(data);
      }
    });
    return cleanup;
  }, [addLog]);

  // listen for command completion
  useEffect(() => {
    const cleanup = api.onComplete((data: any) => {
      setIsFlashing(false);
      setFlashTarget(null);
      if (data && data.code === 0) {
        addLog({ type: LogType.Success, message: 'Operation completed successfully!' });
      } else if (data && (data.code === null || data.code === 'SIGTERM' || data.code === 137)) {
        addLog({ type: LogType.Warning, message: 'Operation cancelled by user' });
      } else {
        addLog({ type: LogType.Error, message: `Operation failed with code ${data?.code}` });
      }
    });
    return cleanup;
  }, [addLog]);

  const clearLogs = useCallback(() => {
    setLogs([]);
  }, []);

  const handleFlash = useCallback((options: any) => {
    setIsFlashing(true);
    setFlashTarget(options.target || null);
    setProgress(0);
    addLog({ type: LogType.Info, message: `Starting flash: ${options.filename}` });
    
    api.flash(options)
      .then(() => {
        setIsFlashing(false);
        setFlashTarget(null);
        addLog({ type: LogType.Success, message: 'Flash completed successfully!' });
      })
      .catch((err) => {
        setIsFlashing(false);
        setFlashTarget(null);
        addLog({ type: LogType.Error, message: `Flash failed: ${err.message || err}` });
      });
  }, [addLog]);

  const renderContent = () => {
    if (isLoading) {
      return (
        <div className="loading">
          <div className="spinner"></div>
          <p>Loading metadata from GitHub...</p>
        </div>
      );
    }

    switch (activeTab) {
      case 'tx_ext':
        return (
          <DeviceView 
            targetType={TargetType.TxExternal}
            versions={versions} 
            devices={devices.tx} 
            onFlash={handleFlash}
            isFlashing={isFlashing}
            flashTarget={flashTarget}
            progress={progress}
          />
        );
      case 'receiver':
        return (
          <DeviceView 
            targetType={TargetType.Receiver}
            versions={versions} 
            devices={devices.rx} 
            onFlash={handleFlash}
            isFlashing={isFlashing}
            flashTarget={flashTarget}
            progress={progress}
          />
        );
      case 'tx_int':
        return (
          <DeviceView 
            targetType={TargetType.TxInternal}
            versions={versions} 
            devices={devices.txint} 
            onFlash={handleFlash}
            isFlashing={isFlashing}
            flashTarget={flashTarget}
            progress={progress}
          />
        );
      case 'lua':
        return (
          <LuaScript 
            versions={versions}
          />
        );
      default:
        return null;
    }
  };

  return (
    <div className="app">
      <Navigation activeTab={activeTab} onTabChange={setActiveTab} />
      <div className="main-content">
        {updateInfo && (
          <UpdateBanner 
            version={updateInfo.latestVersion}
            releaseUrl={updateInfo.releaseUrl}
            onClose={() => setUpdateInfo(null)}
          />
        )}
        <main className="content">
          {renderContent()}
        </main>
        <Console logs={logs} onClear={clearLogs} />
      </div>
    </div>
  );
}

export default App;
