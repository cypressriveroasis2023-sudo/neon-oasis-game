import test from 'node:test';
import assert from 'node:assert/strict';
import {parseHistory, overnightLow, overnightWindow, solarWh, solarVsYesterday, historyFlags, readVrmHistory} from '../src/vrmHistory.ts';
import {safeVrmHistory, isHistoryRequest, gateVerdict, corsHeaders} from '../../supabase/functions/cos-vrm-history/history.ts';
import {victronNeedsAttention} from '../src/victronAttention.ts';

// Local clock times on a fixed date (the test runner's time zone, same as the browser's in practice).
const local = (day, hour, min = 0) => new Date(2026, 10, day, hour, min).getTime();
const s = ms => Math.round(ms / 1000);
const series = (fromMs, toMs, stepMin, fn) => { const out = []; for (let t = fromMs; t <= toMs; t += stepMin * 60000) out.push(fn(t)); return out; };

test('overnight window is 8 PM to 7 AM, the last one that started', () => {
  const morning = overnightWindow(local(24, 9));
  assert.equal(morning.from, s(local(23, 20))); assert.equal(morning.to, s(local(24, 7))); assert.equal(morning.done, true);
  const late = overnightWindow(local(24, 22));
  assert.equal(late.from, s(local(24, 20)));
});

test('overnight low takes the lowest battery in the window and needs a few points', () => {
  const pts = series(local(23, 18), local(24, 9), 15, t => [s(t), new Date(t).getHours() === 4 ? 22 : 70, 0, -20]);
  assert.deepEqual(overnightLow(pts, local(24, 10)).low, 22);
  assert.equal(overnightLow(pts.slice(0, 2), local(24, 10)), null);
});

test('solar energy integrates watts over time and skips long gaps', () => {
  const pts = series(local(24, 8), local(24, 12), 15, t => [s(t), 80, 400, 50]);
  assert.equal(Math.round(solarWh(pts, s(local(24, 8)), s(local(24, 12)))), 1600);
  const gapped = [pts[0], pts[1], ...pts.slice(-3)];
  assert.ok(solarWh(gapped, s(local(24, 8)), s(local(24, 12))) < 1600);
});

test('solar is compared to yesterday by the same clock time, only after noon', () => {
  const day = (d, watts) => series(local(d, 0), local(d, 23, 45), 15, t => [s(t), 80, new Date(t).getHours() >= 7 && new Date(t).getHours() < 18 ? watts : 0, 0]);
  const pts = [...day(23, 400), ...day(24, 100).filter(p => p[0] <= s(local(24, 15)))];
  const cmp = solarVsYesterday(pts, local(24, 15));
  assert.ok(cmp.share > 0.2 && cmp.share < 0.3);
  assert.equal(solarVsYesterday(pts, local(24, 10)), null);
  assert.deepEqual(historyFlags(pts, local(24, 15)).map(f => f.kind), ['solar']);
});

test('history from the server is bounded and numeric; bad points are dropped on the client', () => {
  const now = local(24, 12);
  assert.throws(() => safeVrmHistory({hours: 500, units: []}, now));
  assert.throws(() => safeVrmHistory({hours: 48, units: [{installationId: 1, name: 'Shop bench', points: []}]}, now));
  assert.throws(() => safeVrmHistory({hours: 48, units: [{installationId: 1, name: 'HELIOS 001', points: [[s(now), 120, 0, 0]]}]}, now));
  assert.deepEqual(safeVrmHistory({hours: 48, units: [{installationId: 1, name: 'HELIOS 001', points: [[s(now) - 60, 80, null, -20]]}]}, now).units[0].points, [[s(now) - 60, 80, null, -20]]);
  const parsed = parseHistory({units: [{installationId: 1, name: 'HELIOS 001', points: [[s(now), 80, 0, 0], [s(now), 'x', 0, 0], [1, 2]]}]});
  assert.equal(parsed[0].points.length, 1);
});

test('the history function only answers {"action":"read"}, and only on a plain yes from Operations', () => {
  assert.equal(isHistoryRequest('{"action":"read"}'), true);
  assert.equal(isHistoryRequest('{"action":"read","hours":500}'), false);
  assert.equal(isHistoryRequest('nope'), false);
  assert.equal(gateVerdict(200), 'allow');
  assert.equal(gateVerdict(401), 'denied'); assert.equal(gateVerdict(403), 'denied');
  assert.equal(gateVerdict(500), 'unavailable'); assert.equal(gateVerdict(409), 'unavailable');
  assert.equal(corsHeaders('https://evil.example')['Access-Control-Allow-Origin'], undefined);
  assert.equal(corsHeaders('https://cypressriveroasis2023-sudo.github.io')['Access-Control-Allow-Origin'], 'https://cypressriveroasis2023-sudo.github.io');
});

test('reading history never throws: no token, a refusal or bad JSON all mean no history', async () => {
  assert.equal(await readVrmHistory(async () => { throw Error('x'); }, null), null);
  assert.equal(await readVrmHistory(async () => new Response('{}', {status: 401}), 't'), null);
  assert.equal(await readVrmHistory(async () => new Response('nope', {status: 200}), 't'), null);
  const ok = await readVrmHistory(async () => new Response(JSON.stringify({hours: 48, units: [{installationId: 1, name: 'HELIOS 001', points: []}]}), {status: 200}), 't');
  assert.equal(ok.length, 1);
});

test('Needs attention adds history flags only for Field units with a current reading and nothing stronger', () => {
  const now = local(24, 10);
  const m = (metric, value, unit) => ({metric, value, unit, source: 'system', instance: 0, observedAt: new Date(now - 120000).toISOString()});
  const units = [1, 2].map(id => ({installationId: id, name: 'HELIOS 00' + id, portalUrl: 'https://vrm.victronenergy.com/installation/1/dashboard', embedUrl: null}));
  const rows = [{installationId: 1, name: 'HELIOS 001', lastAttemptAt: null, errorCode: null, measurements: [m('battery_soc', 80, '%')]},
    {installationId: 2, name: 'HELIOS 002', lastAttemptAt: null, errorCode: null, measurements: [m('battery_soc', 10, '%')]}];
  const night = series(local(23, 18), local(24, 9), 15, t => [s(t), new Date(t).getHours() === 3 ? 18 : 60, 0, -20]);
  const history = new Map([[1, night], [2, night]]);
  const inventory = [{unitNumber: 'HELIOS 001', placement: 'FIELD'}, {unitNumber: 'HELIOS 002', placement: 'FIELD'}];
  const list = victronNeedsAttention(units, rows, inventory, now, history);
  assert.deepEqual(list.map(i => [i.name, i.kind]), [['HELIOS 002', 'low'], ['HELIOS 001', 'overnight']]);
  assert.match(list[1].line, /Dropped to 18% overnight/);
  // Without history, nothing extra.
  assert.equal(victronNeedsAttention(units, rows, inventory, now, null).length, 1);
});
