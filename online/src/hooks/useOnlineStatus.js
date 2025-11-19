import { useState, useEffect } from 'react';

export default function useOnlineStatus() {
  const getInitial = () =>
    typeof navigator !== 'undefined' ? navigator.onLine : true;

  const [isOnline, setIsOnline] = useState(getInitial);

  useEffect(() => {
    if (typeof window === 'undefined') return;

    function handleOnline() {
      setIsOnline(true);
    }
    function handleOffline() {
      setIsOnline(false);
    }

    window.addEventListener('online', handleOnline);
    window.addEventListener('offline', handleOffline);

    // Some browsers can change navigator.onLine without events (rare) — recheck on visibility change
    function handleVisibility() {
      setIsOnline(navigator.onLine);
    }
    document.addEventListener('visibilitychange', handleVisibility);

    return () => {
      window.removeEventListener('online', handleOnline);
      window.removeEventListener('offline', handleOffline);
      document.removeEventListener('visibilitychange', handleVisibility);
    };
  }, []);

  return isOnline;
}