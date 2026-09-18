import './styles.css';
import './app.js';
import './technician-wizard-live.js';

if ('serviceWorker' in navigator) {
  window.addEventListener('load', () => {
    navigator.serviceWorker.register('./sw.js', { scope: './', updateViaCache: 'none' }).catch((error) => {
      console.warn('Tech Check service worker registration failed', error);
    });
  });
}
