import { useState, useEffect, useCallback, useRef, lazy, Suspense } from 'react';
import Navigation from './components/Navigation';
import Console from './components/Console';
import UpdateBanner from './components/UpdateBanner';
import BrowserWarning from './components/BrowserWarning';
import { TargetType, LogType, BackendTarget } from './constants';
import './styles/app.css';
import { api } from './api/webSerialApi';
import type { LogEntry, Version } from './types';

const DeviceView = lazy(() => import('./components/DeviceView'));
const LuaScript = lazy(() => import('./components/LuaScript'));
// SwdTest is hidden from navigation but kept for development use
// const SwdTest = lazy(() => import('./components/SwdTest'));


function App() {
  const [activeTab, setActiveTab] = useState<TargetType | 'lua'>(TargetType.TxExternal);
  const [logs, setLogs] = useState<LogEntry[]>([]);
  const [versions, setVersions] = useState<Version[]>([]);
  const [devices, setDevices] = useState<{ tx: string[], rx: string[], txint: string[] }>({ tx: [], rx: [], txint: [] });
  const [isLoading, setIsLoading] = useState(true);
  const [isFlashing, setIsFlashing] = useState(false);
  const [flashTarget, setFlashTarget] = useState<BackendTarget | null>(null);
  const [progress, setProgress] = useState(0);
  const [updateInfo, setUpdateInfo] = useState<{ latestVersion: string; releaseUrl: string; updateAvailable: boolean } | null>(null);
  const [useLocalFile, setUseLocalFile] = useState(false);

  const hasLoaded = useRef(false);

  const addLog = useCallback((entry: LogEntry) => {
    const timestamp = new Date().toLocaleTimeString();
    setLogs(prev => [...prev.slice(-200), { ...entry, timestamp }]); // keep last 200 entries
  }, []);

  // clear all flasher localStorage keys on page load
  // selections only persist within a session, not across reloads
  const clearFlasherSelections = () => {
    const keysToRemove = Object.keys(localStorage).filter(key => key.startsWith('flasher_'));
    keysToRemove.forEach(key => localStorage.removeItem(key));
  };

  // load initial data on mount
  useEffect(() => {
    clearFlasherSelections();
    
    async function loadInitialData() {
      if (hasLoaded.current) return;
      hasLoaded.current = true;

      try {
        addLog({ type: LogType.Info, message: 'Downloading metadata from GitHub...' });
        
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
          addLog({ type: LogType.Error, message: 'No firmware versions found.' });
        } else {
          addLog({ type: LogType.Info, message: 'Metadata loaded successfully' });
        }
      } catch (err) {
        addLog({ type: LogType.Error, message: `Failed to load metadata: ${err instanceof Error ? err.message : String(err)}` });
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
      // Data type from backend (callback in webSerialApi)
      // currently untyped in callback signature, but structure is { type: 'progress'|'log'|LogType, ... }
      if (data.type === 'progress') {
        setProgress(data.progress);
      } else {
        addLog(data as LogEntry);
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
    // options is loosely typed coming from child components, but should match FlasherOptions args
    // However, handleFlash takes the UI options and passes them to api.flash

    setIsFlashing(true);
    setFlashTarget(options.target || null);
    setProgress(0);
    addLog({ type: LogType.Info, message: `Starting flash: ${options.filename}` });
    
    // cast to the expected input for api.flash (which is strict now)
    // api.flash signature: (options: { filename, version, port?, usbDeviceName?, ... })
    api.flash(options)
      .then(() => {
        setIsFlashing(false);
        setFlashTarget(null);
        addLog({ type: LogType.Success, message: 'Flash completed successfully!' });
      })
      .catch((err) => {
        setIsFlashing(false);
        setFlashTarget(null);
        addLog({ type: LogType.Error, message: `Flash failed: ${err instanceof Error ? err.message : String(err)}` });
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

    return (
      <Suspense fallback={<div className="loading"><div className="spinner"></div><p>Loading component...</p></div>}>
        {(() => {
          switch (activeTab) {
            case TargetType.TxExternal:
              return (
                <DeviceView 
                  key={TargetType.TxExternal}
                  targetType={TargetType.TxExternal}
                  versions={versions} 
                  devices={devices.tx} 
                  onFlash={handleFlash}
                  isFlashing={isFlashing}
                  flashTarget={flashTarget}
                  progress={progress}
                  useLocalFile={useLocalFile}
                />
              );
            case TargetType.Receiver:
              return (
                <DeviceView 
                  key={TargetType.Receiver}
                  targetType={TargetType.Receiver}
                  versions={versions} 
                  devices={devices.rx} 
                  onFlash={handleFlash}
                  isFlashing={isFlashing}
                  flashTarget={flashTarget}
                  progress={progress}
                  useLocalFile={useLocalFile}
                />
              );
            case TargetType.TxInternal:
              return (
                <DeviceView 
                  key={TargetType.TxInternal}
                  targetType={TargetType.TxInternal}
                  versions={versions} 
                  devices={devices.txint} 
                  onFlash={handleFlash}
                  isFlashing={isFlashing}
                  flashTarget={flashTarget}
                  progress={progress}
                  useLocalFile={useLocalFile}
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
        })()}
      </Suspense>
    );
  };

  return (
    <div className="app">
      <Navigation activeTab={activeTab} onTabChange={setActiveTab} useLocalFile={useLocalFile} onLocalFileToggle={setUseLocalFile} />
      <div className="main-content">
        {updateInfo && (
          <UpdateBanner 
            version={updateInfo.latestVersion}
            releaseUrl={updateInfo.releaseUrl}
            onClose={() => setUpdateInfo(null)}
          />
        )}
        <BrowserWarning />
        <main className="content">
          {renderContent()}
        </main>
        <Console logs={logs} onClear={clearLogs} />
      </div>
    </div>
  );
}

export default App;
