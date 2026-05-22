import React from 'react';
import ReactDOM from 'react-dom/client';
import App from './App';
import './index.css';

void (async () => {
  if (import.meta.env.DEV) {
    const { installDevChromeMock } = await import('./dev-chrome-mock');
    installDevChromeMock();
  }
})();

ReactDOM.createRoot(document.getElementById('root')!).render(
  <React.StrictMode>
    <App />
  </React.StrictMode>,
);
