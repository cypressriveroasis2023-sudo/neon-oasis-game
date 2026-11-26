import test from 'node:test';
import assert from 'node:assert/strict';
import {nightReport, nightWindow} from '../src/vrmNightReport.ts';

const local = (day, hour, min = 0) => new Date(2026, 10, day, hour, min).getTime();
const s = ms => Math.round(ms / 1000);
const night = (start, perHour, solar = 0) => { const out = []; for (let t = local(24, 21); t <= local(25, 7); t += 900000) out.push([s(t), Math.max(0, start - perHour * (t - local(24, 21)) / 3600000), solar, solar ? 0 : -33]); return out; };
const units = ['HELIOS 001', 'HELIOS 002', 'HELIOS 003', 'HELIOS 004', 'HELIOS 005'].map((name, i) => ({installationId: i + 1, name}));

test('the night is the last finished 5 PM to 7 AM, or tonight so far', () => {
  assert.deepEqual(nightWindow(local(25, 8)), {from: s(local(24, 17)), to: s(local(25, 7)), done: true});
  assert.equal(nightWindow(local(25, 2)).done, false);
  assert.equal(nightWindow(local(25, 18)).from, s(local(24, 17)));   // early evening still shows last night
  assert.equal(nightWindow(local(25, 20)).from, s(local(25, 17)));
});

test('report: statuses, the numbers on top, and plain bottom lines', () => {
  const history = new Map([[1, night(83, 1.1)], [2, night(40, 1.2)], [3, night(100, 0, 33)], [4, night(30, 1.5)]]);
  const r = nightReport(units, history, local(25, 8));
  assert.deepEqual(r.rows.map(x => [x.name, x.status, x.label]), [
    ['HELIOS 004', 'act', 'Went under 20%'], ['HELIOS 002', 'watch', 'Under 30%'], ['HELIOS 001', 'ok', 'OK'],
    ['HELIOS 003', 'power', 'Full, on outside power'], ['HELIOS 005', 'none', 'Not reporting']]);
  const one = r.rows.find(x => x.name === 'HELIOS 001');
  assert.deepEqual([one.start, one.end, one.low, one.perHour], [83, 72, 72, 1.1]);
  assert.equal(r.reporting, 4); assert.equal(r.attention, 2); assert.equal(r.silent, 1);
  assert.deepEqual(r.lowest, {name: 'HELIOS 004', low: 15});
  assert.equal(r.bottom[0], '2 units need a look: HELIOS 004, HELIOS 002.');
  assert.match(r.bottom.join(' '), /On outside power all night: HELIOS 003\./);
});

test('a good night says so', () => {
  const r = nightReport(units.slice(0, 1), new Map([[1, night(95, 1)]]), local(25, 8));
  assert.equal(r.bottom[0], 'Every reporting Helios made it through the night.');
  assert.equal(r.bottom[1], 'Battery at 7 AM: 85% for the units on battery.');
});

test('Shop units are listed but never counted as needing a look', () => {
  const r = nightReport(units.slice(0, 1), new Map([[1, night(30, 1.5)]]), local(25, 8), name => name === 'HELIOS 001');
  assert.equal(r.rows[0].status, 'act'); assert.equal(r.attention, 0);
});

test('a Shop unit that is not powered is not counted as not reporting', () => {
  const r = nightReport(units, new Map([[1, night(83, 1.1)]]), local(25, 8), name => name !== 'HELIOS 001' && name !== 'HELIOS 002');
  assert.equal(r.reporting, 1); assert.equal(r.silent, 1); assert.equal(r.shopOff, 3);
  assert.match(r.bottom.join(' '), /1 not reporting/);
  assert.match(r.bottom.join(' '), /3 in the shop, not powered\./);
});
