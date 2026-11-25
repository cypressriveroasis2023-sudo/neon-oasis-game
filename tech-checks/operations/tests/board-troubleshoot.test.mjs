import test from 'node:test';
import assert from 'node:assert/strict';
import {troubleStart, troubleWalk, troubleKnown, troubleNote} from '../src/cosBoard/boardTrouble.ts';

const base = {status: 'issues', place: 'field', offCams: [{name: 'Cam 3', since: 1764000000}], routerOn: true, routerOff: false,
  power: null, canCheck: true, routerPage: true, camPages: true};
const at = (facts, ans) => troubleWalk(facts, ans).at;

test('only field units with cameras off or down get troubleshooting', () => {
  assert.equal(troubleStart({...base, place: 'shop'}), null);
  assert.equal(troubleStart({...base, status: 'up'}), null);
  assert.equal(troubleStart({...base, status: 'unknown'}), null, 'Unknown is not down: no walk that assumes a fault');
  assert.equal(troubleStart(base), 'night');
  assert.equal(troubleWalk({...base, status: 'up'}, {}).at, null);
});

test('COS answers what it knows: the offline camera is named, and a low Victron battery goes straight to power', () => {
  const known = troubleKnown(base, () => 'Tue 9:12 PM', () => '26 h');
  assert.deepEqual(known, ['Cam 3 is off since Tue 9:12 PM (26 h)', 'Router answers']);
  const low = {...base, power: {low: true, battery: 18}};
  const r = at(low, {});
  assert.equal(r.kind, 'result');
  assert.equal(r.title, 'Power, not the camera');
  assert.ok(troubleKnown(low, () => '', () => '').includes('Victron battery 18% (low)'));
});

test('no step sends anyone to Star4Live', () => {
  const seen = new Set();
  const walk = (facts, ans) => { const s = at(facts, ans); if (!s || s.kind !== 'step') return;
    const text = [s.question, ...s.how].join(' '); assert.equal(/star4live/i.test(text), false, text);
    if (seen.has(s.id + JSON.stringify(facts.status) + facts.routerOff)) return; seen.add(s.id + JSON.stringify(facts.status) + facts.routerOff);
    for (const o of s.options) walk(facts, {...ans, [s.id]: o.key}); };
  for (const f of [base, {...base, status: 'down', offCams: []}, {...base, status: 'down', routerOn: false, routerOff: true, offCams: []}]) walk(f, {});
  assert.ok(seen.size > 5);
});

test('some cameras off: night no, check still off, ping answers, reboot fails = camera itself', () => {
  const ans = {night: 'no', check: 'off', ping: 'yes', reboot: 'off'};
  const w = troubleWalk(base, ans);
  assert.equal(w.at.title, 'The camera itself is likely bad');
  assert.equal(w.at.managerHelp, true);
  assert.equal(w.trail.length, 4);
  const note = troubleNote('Solar Spotter 044', troubleKnown(base, () => 'Tue', () => '1 h'), w, 'Nov 25');
  assert.match(note, /^Solar Spotter 044 — troubleshoot\nCOS: Cam 3 is off since Tue/);
  assert.match(note, /Manager help: YES/);
  assert.equal(/\d+\.\d+\.\d+\.\d+/.test(note), false, 'no addresses in the note');
});

test('the check step is skipped when the card has no Check it now', () => {
  assert.equal(at({...base, canCheck: false}, {night: 'no'}).id, 'ping');
  assert.equal(at(base, {night: 'no'}).id, 'check');
});

test('whole unit down: router off goes to the SIM, router on goes to pinging the cameras', () => {
  const off = {...base, status: 'down', offCams: [], routerOn: false, routerOff: true};
  assert.equal(at(off, {night: 'no'}).id, 'sim');
  assert.equal(at(off, {night: 'no', sim: 'ok'}).title, 'No power at the unit, or the router failed');
  const on = {...base, status: 'down', offCams: []};
  assert.equal(at(on, {night: 'no', check: 'off'}).id, 'pingAll');
  assert.equal(at(on, {night: 'no', check: 'off', pingAll: 'some'}).title, 'Cameras are up but not reporting');
});

test('an answer that no longer fits stops the walk at that step', () => {
  assert.equal(at(base, {night: 'maybe'}).id, 'night');
});
