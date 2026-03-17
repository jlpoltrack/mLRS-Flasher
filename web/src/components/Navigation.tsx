import React from 'react';
import { Radio, Cpu, FileCode, HardDrive } from 'lucide-react';
import { TargetType } from '../constants';
import './navigation.css';
import logo from '../assets/logo.png';

// last updated: 2026-02-09

interface NavigationProps {
  activeTab: TargetType | 'lua';
  onTabChange: (tabId: TargetType | 'lua') => void;
  useLocalFile: boolean;
  onLocalFileToggle: (value: boolean) => void;
}

function Navigation({ activeTab, onTabChange, useLocalFile, onLocalFileToggle }: NavigationProps) {
  const tabs: { id: TargetType | 'lua'; label: string; icon: React.ReactNode }[] = [
    { id: TargetType.TxExternal, label: 'Tx Module (External)', icon: <Radio size={20} /> },
    { id: TargetType.Receiver, label: 'Receiver', icon: <Cpu size={20} /> },
    { id: TargetType.TxInternal, label: 'Tx Module (Internal)', icon: <Radio size={20} /> },
    { id: 'lua', label: 'Lua Script', icon: <FileCode size={20} /> },
  ];

  return (
    <nav className="navigation">
      <a 
        href="https://github.com/olliw42/mLRS" 
        target="_blank" 
        rel="noopener noreferrer" 
        className="nav-header"
      >
        <img
          src={logo}
          alt="mLRS Logo"
          className="nav-logo"
        />
        <h1 className="nav-title">mLRS Flasher</h1>
      </a>

      <div className="nav-tabs">
        {tabs.map(tab => (
          <button
            key={tab.id}
            className={`nav-tab ${activeTab === tab.id ? 'active' : ''}`}
            onClick={() => onTabChange(tab.id)}
          >
            <span className="tab-icon">{tab.icon}</span>
            <span className="tab-label">{tab.label}</span>
            {activeTab === tab.id && <div className="active-glow" />}
          </button>
        ))}
      </div>

      <div className="nav-footer">
        <button
          className={`nav-tab local-file-tab ${useLocalFile ? 'active' : ''}`}
          onClick={() => onLocalFileToggle(!useLocalFile)}
        >
          <span className="tab-icon"><HardDrive size={20} /></span>
          <span className="tab-label">Local File</span>
          {useLocalFile && <div className="active-glow" />}
        </button>
      </div>
    </nav>
  );
}

export default Navigation;
