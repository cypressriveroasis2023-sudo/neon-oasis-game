import './ownerWatchfulShortcut.css';

export default function OwnerWatchfulShortcut() {
  return <section className='owner-watchful-shortcut' aria-labelledby='owner-watchful-heading'>
    <div><small>EXTERNAL PORTAL</small><h2 id='owner-watchful-heading'>Watchful</h2><p>Open your Watchful sites and camera monitoring portal.</p></div>
    <div className='owner-watchful-action'><a href='https://v2.watchful.co.nz/sites' target='_blank' rel='noopener noreferrer' aria-describedby='owner-watchful-help'>Open Watchful <span aria-hidden='true'>↗</span></a><p id='owner-watchful-help'>Opens in a new tab. Watchful may ask you to sign in.</p></div>
  </section>;
}
