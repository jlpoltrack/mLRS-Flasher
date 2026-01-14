import React, { useState, useEffect } from 'react';
import { isSupported as checkBrowserSupport } from '../api/hardwareService';
import './browserWarning.css';

const BrowserWarning: React.FC = () => {
  const [isSupported, setIsSupported] = useState(true);
  const [isVisible, setIsVisible] = useState(true);

  useEffect(() => {
    setIsSupported(checkBrowserSupport());
  }, []);

  if (isSupported || !isVisible) {
    return null;
  }

  return (
    <div className="browser-warning-overlay">
      <div className="browser-warning-banner">
        <div className="warning-icon">⚠️</div>
        <div className="warning-content">
          <h3>Unsupported Browser Detected</h3>
          <p>
            Your browser does not support <strong>Web Serial</strong> or <strong>WebUSB</strong>, 
             which are required to flash firmware.
          </p>
          <p>
            Please use a Chromium-based browser such as <strong>Google Chrome</strong> or <strong>Microsoft Edge</strong> for full functionality.
          </p>
        </div>
        <button className="dismiss-btn" onClick={() => setIsVisible(false)} title="Dismiss">
          ✕
        </button>
      </div>
    </div>
  );
};

export default BrowserWarning;
