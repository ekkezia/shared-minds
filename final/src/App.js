import logo from './logo.svg';
import './App.css';
import useOnlineStatus from './hooks/useOnlineStatus';
import Online from './components/OnlineStatus/Online';
import Offline from './components/OnlineStatus/Offline';

function App() {
  const isOnline = useOnlineStatus();

  return (
    <div className="App">
      {/* Online/offline indicators */}
      {isOnline ? <Online /> : <Offline />}

      <header className="App-header">
        <img src={logo} className="App-logo" alt="logo" />
        <p>
          Edit <code>src/App.js</code> and save to reload.
        </p>
        <a
          className="App-link"
          href="https://reactjs.org"
          target="_blank"
          rel="noopener noreferrer"
        >
          Learn React
        </a>
      </header>
    </div>
  );
}

export default App;
