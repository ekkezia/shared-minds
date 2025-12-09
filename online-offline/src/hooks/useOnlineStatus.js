// src/hooks/useOnlineStatus.js
import { useState, useEffect } from 'preact/hooks';

export default function useOnlineStatus() {
  const getInitial = () =>
    typeof navigator !== 'undefined' && 'onLine' in navigator
      ? navigator.onLine
      : true;

  const [isOnline, setIsOnline] = useState(getInitial);

  useEffect(() => {
    let wasOnline = getInitial();
    
    function update() {
      const nowOnline = Boolean(navigator.onLine);
      
      // Log connectivity changes for debugging
      if (wasOnline !== nowOnline) {
        console.log('[useOnlineStatus] Connectivity changed', {
          from: wasOnline ? 'online' : 'offline',
          to: nowOnline ? 'online' : 'offline',
          timestamp: new Date().toISOString(),
        });
        wasOnline = nowOnline;
      }
      
      setIsOnline(nowOnline);
    }

    // Keep a single handler for both events
    window.addEventListener('online', update);
    window.addEventListener('offline', update);

    // Ensure initial value is correct (in case it changed before effect ran)
    update();

    return () => {
      window.removeEventListener('online', update);
      window.removeEventListener('offline', update);
    };
  }, []);

  return isOnline;
}
