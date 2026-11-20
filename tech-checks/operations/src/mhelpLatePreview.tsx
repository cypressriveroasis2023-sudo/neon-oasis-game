import React from 'react';
import ReactDOM from 'react-dom/client';
import {centralClock, fieldListLine, presentValue, updatesDelayedLine} from './feedFreshness';
import './fleetDashboard.css';
import './mhelpLatePreview.css';

const NOW = Date.parse('2026-11-20T02:09:00Z');
const MHELP = Date.parse('2026-11-19T23:36:00Z');
const units = presentValue('186 / 196', '186 / 196', [{readAt: MHELP}], NOW);
const cameras = presentValue('702 / 731', '702 / 731', [{readAt: MHELP}], NOW);
const delayed = updatesDelayedLine('mhelp', MHELP);
const asOf = centralClock(MHELP);
const fieldList = fieldListLine(MHELP);

const pins = [
  [18, 42], [24, 48], [30, 55], [36, 46], [42, 62], [48, 58], [55, 70], [22, 68],
  [33, 74], [40, 80], [52, 76], [60, 64], [28, 38], [46, 40], [58, 48], [64, 72],
  [38, 52], [50, 54], [44, 66], [26, 58],
];

function Box({label, value, note, live}:{label:string; value:string; note:string; live?:boolean}) {
  return <article className={'late-box'+(live?' late-live':' late-stale')}>
    <span>{label}</span>
    <strong className={live?'':'cos-stale-figure'}>{value}</strong>
    <small>{note}</small>
  </article>;
}

function Board() {
  return <main className="late-board">
    <header>
      <h1>Fleet</h1>
      <p className="cos-updates-delayed" role="status">{delayed}</p>
    </header>
    <section className="late-boxes" aria-label="Fleet scope summary">
      <Box label="Units online" value={units.text} note={units.note||''}/>
      <Box label="Cameras online" value={cameras.text} note={cameras.note||''}/>
      <Box label="Problems" value="6" note={fieldList} live/>
      <article className="late-box late-live">
        <span>Checks still live</span>
        <strong>Camera · Router · Battery</strong>
        <small>Camera, router and battery checks are current.</small>
      </article>
    </section>
    <section className={'late-map cos-pins-stale'} aria-label="Map">
      {pins.map(([x, y], index) => <i key={index} style={{left: x+'%', top: y+'%'}}/>)}
      <p>Pins: mHelp address, not GPS · as of {asOf}</p>
    </section>
    <section className="late-rows" aria-label="Needs attention">
      <h2>Needs attention</h2>
      <p className="cos-field-tag-stale">Field · as of {asOf}</p>
      <ul>
        <li><b>Spotter 901</b><span>2 of 4 cameras offline</span><time>6:38 AM</time></li>
        <li><b>Ranger 902</b><span>Router not answering</span><time>6:38 AM</time></li>
        <li><b>Helios 904</b><span>Battery low · 18%</span><time>6:35 AM</time></li>
      </ul>
    </section>
  </main>;
}

const root = document.getElementById('root');
if (!root) throw new Error('Preview root is missing.');
ReactDOM.createRoot(root).render(<Board/>);
