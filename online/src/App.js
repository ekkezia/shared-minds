import './App.css';
import useOnlineStatus from './hooks/useOnlineStatus';
import Online from './components/OnlineStatus/Online';
import Offline from './components/OnlineStatus/Offline';

function App() {
  const isOnline = useOnlineStatus();

  return (
    <div className='App'>
      {/* Online/offline indicators */}
      {isOnline ? <Online /> : <Offline />}
    </div>
  );
}

export default App;
