import React from 'react';
import { Radio, Cpu, FileCode } from 'lucide-react';
import { TargetType } from '../constants';
import './navigation.css';
import logo from '../assets/logo.png';

interface NavigationProps {
  activeTab: TargetType | 'lua';
  onTabChange: (tabId: TargetType | 'lua') => void;
}

function Navigation({ activeTab, onTabChange }: NavigationProps) {
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
    </nav>
  );
}

export default Navigation;
