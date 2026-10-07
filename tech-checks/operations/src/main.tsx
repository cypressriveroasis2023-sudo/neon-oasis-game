import React from 'react';
import ReactDOM from 'react-dom/client';
import App from './App';
import './index.css';
import './shell.css';
import './companyTheme.css';
import './cameraHealthOverview.css';
import './visionAreas.css';
// The approved company workspace is dark, including technician assignment mode.
document.documentElement.dataset.theme = 'dark';
const root = document.getElementById('root');
if (!root) throw new Error('Operations root is missing.');
ReactDOM.createRoot(root).render(<React.StrictMode><App /></React.StrictMode>);
