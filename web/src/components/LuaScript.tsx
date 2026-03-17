import { useState, useEffect } from 'react';
import { api } from '../api/webSerialApi';
import type { Version, FirmwareFile } from '../types';
import './panel.css';

interface LuaScriptProps {
  versions: Version[];
}

function LuaScript({ versions: _versions }: LuaScriptProps) {
  // edgetx/opentx lua files (root lua folder)
  const [edgeTxFiles, setEdgeTxFiles] = useState<FirmwareFile[]>([]);
  const [selectedEdgeTxFile, setSelectedEdgeTxFile] = useState('');
  
  // ethos lua files (lua/ethos folder)
  const [ethosFiles, setEthosFiles] = useState<FirmwareFile[]>([]);
  const [selectedEthosFile, setSelectedEthosFile] = useState('');
  
  const [isDownloading, setIsDownloading] = useState(false);
  const [error, setError] = useState<string | null>(null);

  // fetch lua files from main branch on mount
  useEffect(() => {
    const fetchFiles = async () => {
      try {
        // fetch edgetx/opentx lua files (root lua folder)
        const edgeTxRes = await api.listFirmware({ 
          type: 'lua', 
          version: 'main',
          luaFolder: 'root'
        });
        const edgeTxList = edgeTxRes.files || [];
        setEdgeTxFiles(edgeTxList);
        if (edgeTxList.length > 0) {
          setSelectedEdgeTxFile(edgeTxList[edgeTxList.length - 1].filename);
        }

        // fetch ethos lua files
        const ethosRes = await api.listFirmware({ 
          type: 'lua', 
          version: 'main',
          luaFolder: 'ethos'
        });
        const ethosList = ethosRes.files || [];
        setEthosFiles(ethosList);
        if (ethosList.length > 0) {
          setSelectedEthosFile('all');
        }
      } catch (err) {
        console.error('Failed to fetch Lua files:', err);
      }
    };

    fetchFiles();
  }, []);

  const handleDownload = async (folder: 'root' | 'ethos') => {
    const files = folder === 'root' ? edgeTxFiles : ethosFiles;
    const selectedFile = folder === 'root' ? selectedEdgeTxFile : selectedEthosFile;
    
    try {
      setIsDownloading(true);
      setError(null);
      
      // determine which files to download
      const filesToDownload = selectedFile === 'all' 
        ? files 
        : files.filter(f => f.filename === selectedFile);
      
      if (filesToDownload.length === 0) {
        throw new Error("No Lua files found to download");
      }

      for (const file of filesToDownload) {
        const response = await fetch(file.url);
        const initialBlob = await response.blob();
        
        const blob = new Blob([initialBlob], { type: 'application/octet-stream' });
        const url = window.URL.createObjectURL(blob);
        
        // trigger browser download
        const a = document.createElement('a');
        a.href = url;
        a.download = file.filename;
        a.target = '_blank';
        a.style.position = 'absolute';
        a.style.left = '-9999px';
        
        document.body.appendChild(a);
        a.click();
        
        // delay cleanup to ensure browser captures the download
        setTimeout(() => {
          window.URL.revokeObjectURL(url);
          document.body.removeChild(a);
        }, 1000);
      }
      
      setIsDownloading(false);
    } catch (err: any) {
      console.error('Failed to download Lua scripts:', err);
      setError(`Failed to start download: ${err.message || err}`);
      setIsDownloading(false);
    }
  };

  // listen for completion
  useEffect(() => {
    const cleanup = api.onComplete((_data: any) => {
      setIsDownloading(false);
    });
    return cleanup;
  }, []);

  return (
    <div className="panel">
      <h2 className="panel-title">Lua Script</h2>
      
      {error && (
        <div className="error-box">
          <strong>❌ Error:</strong> {error}
        </div>
      )}
      
      <div className="form-grid">
        {/* EdgeTX/OpenTX dropdown */}
        <div className="form-group span-2 port-group">
          <label>EdgeTX / OpenTX</label>
          <div className="port-row">
            <div className="select-wrapper">
              <select 
                value={selectedEdgeTxFile} 
                onChange={(e) => setSelectedEdgeTxFile(e.target.value)}
                disabled={isDownloading || edgeTxFiles.length === 0}
              >

                {edgeTxFiles.slice().reverse().map(f => (
                  <option key={f.filename} value={f.filename}>{f.filename}</option>
                ))}
              </select>
            </div>
            
            <div title={isDownloading ? 'Download in progress' : edgeTxFiles.length === 0 ? 'Loading files...' : undefined}>
                <button 
                className="btn-primary"
                onClick={() => handleDownload('root')}
                disabled={isDownloading || edgeTxFiles.length === 0}
                aria-label="Download EdgeTX/OpenTX Lua script"
                >
                {isDownloading ? 'Downloading...' : 'Download'}
                </button>
            </div>
          </div>
        </div>

        {/* Ethos dropdown */}
        <div className="form-group span-2 port-group">
          <label>Ethos</label>
          <div className="port-row">
            <div className="select-wrapper">
              <select 
                value={selectedEthosFile} 
                onChange={(e) => setSelectedEthosFile(e.target.value)}
                disabled={isDownloading || ethosFiles.length === 0}
              >
                {ethosFiles.length > 0 && (
                  <option value="all">All Files</option>
                )}
                {ethosFiles.map(f => (
                  <option key={f.filename} value={f.filename}>{f.filename}</option>
                ))}
              </select>
            </div>
            
            <div title={isDownloading ? 'Download in progress' : ethosFiles.length === 0 ? 'Loading files...' : undefined}>
                <button 
                className="btn-primary"
                onClick={() => handleDownload('ethos')}
                disabled={isDownloading || ethosFiles.length === 0}
                aria-label="Download Ethos Lua scripts"
                >
                {isDownloading ? 'Downloading...' : selectedEthosFile === 'all' ? 'Download All' : 'Download'}
                </button>
            </div>
          </div>
        </div>
      </div>

      {isDownloading && (
        <div style={{ marginTop: '12px' }}>
          <button 
            className="btn-secondary btn-cancel"
            onClick={() => api.cancelPython()}
          >
            Cancel
          </button>
        </div>
      )}

      <div className="description-box">
        <div className="flash-card-header">
           <div className="flash-card-title">LUA NOTES</div>
        </div>
        <div className="description-content">
          <div>
            Download the Lua configuration scripts for your radio. 
            These scripts allow you to configure mLRS parameters directly from your radio's interface.
          </div>
          <div>
            After downloading, copy the files to your radio's SD card:
            <ul>
              <li style={{ marginTop: '8px' }}>
                <strong>EdgeTX/OpenTX:</strong> Copy <strong>only ONE</strong> Lua file to <code>/SCRIPTS/TOOLS/</code>.
                <br />
                <span style={{ fontSize: '0.9em', color: 'var(--text-secondary)' }}>
                  Select the script matching your radio type — mLRS.lua for color screen radios, mLRS-bw.lua for black and white screen radios.
                </span>
              </li>
              <li style={{ marginTop: '8px' }}><strong>Ethos:</strong> Copy all files to <code>/scripts/mLRS/</code></li>
            </ul>
          </div>
        </div>
      </div>

    </div>
  );
}

export default LuaScript;
