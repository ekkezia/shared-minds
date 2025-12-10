// src/hooks/useOnlineStatus.js
import { useState, useEffect, useCallback } from 'preact/hooks';

/**
 * Network types considered "good enough" for recording/uploading
 * Anything below 3G is considered too slow
 */
const GOOD_NETWORK_TYPES = ['4g', 'wifi', 'ethernet', 'wimax'];
const SLOW_NETWORK_TYPES = ['slow-2g', '2g', '3g']; // 3g and below = switch to playback

/**
 * Check if network quality is good enough for uploading
 * Returns true if network is good, false if slow/offline
 */
function isNetworkGoodEnough() {
  // If offline, definitely not good enough
  if (!navigator.onLine) {
    return false;
  }

  // Check Network Information API (not supported in all browsers)
  // @ts-ignore - navigator.connection is not in all TypeScript definitions
  const connection = navigator.connection || navigator.mozConnection || navigator.webkitConnection;
  
  if (connection) {
    const effectiveType = connection.effectiveType; // '4g', '3g', '2g', 'slow-2g'
    const downlink = connection.downlink; // Mbps
    const rtt = connection.rtt; // Round-trip time in ms

    console.log('[useOnlineStatus] Network info', {
      effectiveType,
      downlink: downlink ? `${downlink} Mbps` : 'unknown',
      rtt: rtt ? `${rtt}ms` : 'unknown',
      type: connection.type, // 'wifi', 'cellular', etc.
    });

    // If effectiveType is slow-2g, 2g, or 3g, consider it too slow
    if (SLOW_NETWORK_TYPES.includes(effectiveType)) {
      console.log('[useOnlineStatus] ⚠️ Network too slow', { effectiveType });
      return false;
    }

    // If downlink is very low (< 0.5 Mbps), consider it too slow
    if (downlink !== undefined && downlink < 0.5) {
      console.log('[useOnlineStatus] ⚠️ Downlink too slow', { downlink });
      return false;
    }

    // If RTT is very high (> 2000ms), consider it too slow
    if (rtt !== undefined && rtt > 2000) {
      console.log('[useOnlineStatus] ⚠️ RTT too high', { rtt });
      return false;
    }
  }

  // If we can't detect network quality, assume it's good if online
  return true;
}

export default function useOnlineStatus() {
  const getInitialOnline = () =>
    typeof navigator !== 'undefined' && 'onLine' in navigator
      ? navigator.onLine
      : true;

  const [isOnline, setIsOnline] = useState(getInitialOnline);
  const [isNetworkGood, setIsNetworkGood] = useState(true);

  // Combined status: online AND network is good enough
  const [isEffectivelyOnline, setIsEffectivelyOnline] = useState(() => {
    return getInitialOnline() && isNetworkGoodEnough();
  });

  const updateStatus = useCallback(() => {
    const nowOnline = Boolean(navigator.onLine);
    const networkGood = isNetworkGoodEnough();
    const effectivelyOnline = nowOnline && networkGood;

    console.log('[useOnlineStatus] Status update', {
      browserOnline: nowOnline,
      networkGood,
      effectivelyOnline,
      timestamp: new Date().toISOString(),
    });

    setIsOnline(nowOnline);
    setIsNetworkGood(networkGood);
    setIsEffectivelyOnline(effectivelyOnline);
  }, []);

  useEffect(() => {
    // Initial check
    updateStatus();

    // Listen for online/offline events
    window.addEventListener('online', updateStatus);
    window.addEventListener('offline', updateStatus);

    // Listen for network quality changes (if supported)
    // @ts-ignore
    const connection = navigator.connection || navigator.mozConnection || navigator.webkitConnection;
    if (connection) {
      connection.addEventListener('change', updateStatus);
    }

    // Periodically check network quality (every 5 seconds when online)
    const intervalId = setInterval(() => {
      if (navigator.onLine) {
        updateStatus();
      }
    }, 5000);

    return () => {
      window.removeEventListener('online', updateStatus);
      window.removeEventListener('offline', updateStatus);
      if (connection) {
        connection.removeEventListener('change', updateStatus);
      }
      clearInterval(intervalId);
    };
  }, [updateStatus]);

  // Return the effective online status (considers network quality)
  return isEffectivelyOnline;
}

// Export individual status hooks for more granular control
export function useDetailedOnlineStatus() {
  const getInitialOnline = () =>
    typeof navigator !== 'undefined' && 'onLine' in navigator
      ? navigator.onLine
      : true;

  const [status, setStatus] = useState({
    browserOnline: getInitialOnline(),
    networkGood: true,
    effectivelyOnline: getInitialOnline(),
    effectiveType: null,
    downlink: null,
    rtt: null,
  });

  useEffect(() => {
    function update() {
      const browserOnline = Boolean(navigator.onLine);
      const networkGood = isNetworkGoodEnough();
      
      // @ts-ignore
      const connection = navigator.connection || navigator.mozConnection || navigator.webkitConnection;
      
      setStatus({
        browserOnline,
        networkGood,
        effectivelyOnline: browserOnline && networkGood,
        effectiveType: connection?.effectiveType || null,
        downlink: connection?.downlink || null,
        rtt: connection?.rtt || null,
      });
    }

    update();

    window.addEventListener('online', update);
    window.addEventListener('offline', update);

    // @ts-ignore
    const connection = navigator.connection || navigator.mozConnection || navigator.webkitConnection;
    if (connection) {
      connection.addEventListener('change', update);
    }

    const intervalId = setInterval(update, 5000);

    return () => {
      window.removeEventListener('online', update);
      window.removeEventListener('offline', update);
      if (connection) {
        connection.removeEventListener('change', update);
      }
      clearInterval(intervalId);
    };
  }, []);

  return status;
}
