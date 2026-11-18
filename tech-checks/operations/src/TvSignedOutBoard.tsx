import {useEffect, useState} from 'react';
import './techCheckTvBoard.css';
import {tvSessionHold} from './tvSessionHold';

/** Clock and exit only. No saved cards, pins, names, or reads. */
export default function TvSignedOutBoard({note, exit}: {note: string; exit: () => void}) {
  const [now, setNow] = useState(() => new Date());
  useEffect(() => {
    const timer = window.setInterval(() => setNow(new Date()), 10000);
    const escape = (event: KeyboardEvent) => { if (event.key === 'Escape') exit(); };
    window.addEventListener('keydown', escape);
    if (window.parent !== window) window.parent.postMessage({type: 'COS_TV_BOARD_DISPLAY_MODE', active: true}, location.origin);
    return () => {
      window.clearInterval(timer);
      window.removeEventListener('keydown', escape);
      if (!tvSessionHold() && window.parent !== window) window.parent.postMessage({type: 'COS_TV_BOARD_DISPLAY_MODE', active: false}, location.origin);
    };
  }, [exit]);
  return <section className='tech-check-tv' aria-label='Tech Check TV Board' data-section='signed-out'>
    <header className='tech-check-tv-header'>
      <div className='tech-check-tv-brand'><div><h1>TECH CHECK <span>TV BOARD</span></h1></div></div>
      <div className='tech-check-tv-clock'><b>{now.toLocaleTimeString('en-US', {timeZone: 'America/Chicago', hour: 'numeric', minute: '2-digit'})}</b><span>{now.toLocaleDateString('en-US', {timeZone: 'America/Chicago', weekday: 'long', month: 'short', day: 'numeric'})} · CT</span></div>
    </header>
    <p className='tech-check-tv-reconnecting' role='status'>{note}</p>
    <footer className='tech-check-tv-footer'><div/><nav aria-label='TV controls'><button type='button' onClick={exit}>Exit TV</button></nav></footer>
  </section>;
}
