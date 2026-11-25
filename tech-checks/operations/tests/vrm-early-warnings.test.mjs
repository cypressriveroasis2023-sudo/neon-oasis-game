import test from 'node:test';
import assert from 'node:assert/strict';
import {dayPeak, nightLoad, historyFlags} from '../src/vrmHistory.ts';

const local = (day, hour, min = 0) => new Date(2026, 10, day, hour, min).getTime();
const s = ms => Math.round(ms / 1000);
// One reading every 15 minutes from `from` to `to` (ms), battery from f(t), solar, battery watts.
const series = (from, to, soc, solar, bat) => { const out = []; for (let t = from; t <= to; t += 900000) out.push([s(t), soc(t), solar, bat]); return out; };
const day = (d, top) => series(local(d, 7), local(d, 17), t => Math.min(top, 60 + (t - local(d, 7)) / 3600000 * 6), 200, 150);

test('a full day is fine, a day that stops short is flagged after 5 PM', () => {
  assert.equal(dayPeak(day(24, 100), local(24, 18)).peak, 100);
  assert.deepEqual(historyFlags(day(24, 100), local(24, 18)), []);
  const short = day(24, 82);
  assert.deepEqual(dayPeak(short, local(24, 18)), {peak: 82, label: 'today'});
  assert.deepEqual(historyFlags(short, local(24, 18)).map(f => f.kind), ['notfull']);
  assert.match(historyFlags(short, local(24, 18))[0].line, /Didn't fill up today · best was 82%/);
});

test('after midnight it talks about yesterday; during the day it waits', () => {
  assert.equal(dayPeak(day(24, 82), local(25, 2)).label, 'yesterday');
  assert.equal(dayPeak(day(24, 82), local(24, 13)), null);
});

test('too few daytime readings is not judged', () => {
  assert.equal(dayPeak(series(local(24, 7), local(24, 9), () => 70, 100, 50), local(24, 18)), null);
});

test('night power: normal draw is fine, a big jump is flagged', () => {
  const lastNight = series(local(24, 20), local(25, 6), () => 90, 0, -34);
  const steady = [...lastNight, ...series(local(25, 20), local(25, 22), () => 85, 0, -35)];
  const n = nightLoad(steady, local(25, 22));
  assert.equal(n.normal, 34); assert.equal(n.high, false);
  const jump = [...lastNight, ...series(local(25, 20), local(25, 22), () => 85, 0, -60)];
  const j = nightLoad(jump, local(25, 22));
  assert.deepEqual(j, {recent: 60, normal: 34, high: true});
  assert.match(historyFlags(jump, local(25, 22)).find(f => f.kind === 'load').line, /Using more power than usual · 60 W vs normal 34 W/);
});

test('no history from an earlier night means no load verdict', () => {
  assert.equal(nightLoad(series(local(24, 21), local(24, 23), () => 90, 0, -60), local(24, 23)), null);
});

test('readings with sun or charging do not count as night draw', () => {
  const pts = [...series(local(24, 20), local(25, 6), () => 90, 0, -34), ...series(local(25, 20), local(25, 22), () => 100, 35, 0)];
  assert.equal(nightLoad(pts, local(25, 22)), null);
});
