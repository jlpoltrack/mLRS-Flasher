import { useState, useEffect, useCallback, useRef } from 'react';
import Navigation from './components/Navigation';
import TxModuleExternal from './components/TxModuleExternal';
import Receiver from './components/Receiver';
import TxModuleInternal from './components/TxModuleInternal';
import LuaScript from './components/LuaScript';
import Console from './components/Console';
import UpdateBanner from './components/UpdateBanner';
import './styles/app.css';
import { api } from './api/webSerialApi';

interface LogEntry {
  type: 'info' | 'error' | 'success' | 'warning';
  message: string;
  timestamp?: string;
}

function App() {
  const [activeTab, setActiveTab] = useState('tx_ext');
  const [logs, setLogs] = useState<LogEntry[]>([]);
  const [versions, setVersions] = useState<any[]>([]);
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
    async function loadInitialData() {
      if (hasLoaded.current) return;
      hasLoaded.current = true;

      try {
        addLog({ type: 'info', message: 'Downloading metadata from GitHub...' });
        
        const versionsResult = await api.listVersions();
        const loadedVersions = versionsResult.versions || [];
        setVersions(loadedVersions);
        
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
          addLog({ type: 'error', message: 'No firmware versions found.' });
        } else {
          addLog({ type: 'info', message: 'Metadata loaded successfully' });
        }
      } catch (err: any) {
        addLog({ type: 'error', message: `Failed to load metadata: ${err.message || err}` });
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
        addLog({ type: 'success', message: 'Operation completed successfully!' });
      } else if (data && (data.code === null || data.code === 'SIGTERM' || data.code === 137)) {
        addLog({ type: 'warning', message: 'Operation cancelled by user' });
      } else {
        addLog({ type: 'error', message: `Operation failed with code ${data?.code}` });
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
    addLog({ type: 'info', message: `Starting flash: ${options.filename}` });
    
    api.flash(options)
      .then(() => {
        setIsFlashing(false);
        setFlashTarget(null);
        addLog({ type: 'success', message: 'Flash completed successfully!' });
      })
      .catch((err) => {
        setIsFlashing(false);
        setFlashTarget(null);
        addLog({ type: 'error', message: `Flash failed: ${err.message || err}` });
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
          <TxModuleExternal 
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
          <Receiver 
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
          <TxModuleInternal 
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
