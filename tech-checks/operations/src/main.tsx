import React from 'react';
import ReactDOM from 'react-dom/client';
import App from './App';
import ViewErrorBoundary from './ViewErrorBoundary';
import MhelpLocationImport from './MhelpLocationImport';
import './index.css';
import './shell.css';
import './companyTheme.css';
import './cameraHealthOverview.css';
import './visionAreas.css';
import './mhelpTicketPrivateSample.css';
// The approved company workspace is dark, including technician assignment mode.
document.documentElement.dataset.theme = 'dark';
const root = document.getElementById('root');
if (!root) throw new Error('Operations root is missing.');
ReactDOM.createRoot(root).render(
  <React.StrictMode>
    <ViewErrorBoundary fallback={(retry, reference) => (
      <main className="cos-fleet-message" role="alert">
        <h1>Couldn’t display COS Operations</h1>
        <p>Try opening the workspace again.</p>
        <small>Display reference {reference}</small>
        <button type="button" onClick={retry}>Reopen workspace</button>
      </main>
    )}>
      {new URLSearchParams(location.search).get('locationImport') === '1' ? <MhelpLocationImport /> : <App />}
    </ViewErrorBoundary>
  </React.StrictMode>
);
