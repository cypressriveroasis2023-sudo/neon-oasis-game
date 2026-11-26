import test from 'node:test';
import assert from 'node:assert/strict';
import {victronFleetView} from '../src/victronAttention.ts';

const unit = (n, placement, tone) => ({installationId: n, name: 'HELIOS ' + String(n).padStart(3, '0'), placement, tone, fresh: ['good', 'fair', 'low'].includes(tone)});
const view = units => victronFleetView(units, u => u.placement, u => u);

test('Shop units go last and a Shop unit that is not powered is not counted as down', () => {
  const v = view([unit(1, 'field', 'good'), unit(2, 'shop', 'stale'), unit(3, 'field', 'low'), unit(4, 'shop', 'none'), unit(5, 'field', 'fair')]);
  assert.deepEqual(v.ordered.map(u => u.installationId), [1, 3, 5, 2, 4]);
  assert.deepEqual([...v.shopOff], [2, 4]);
  assert.deepEqual(v.shopOn, []);
  assert.deepEqual(v.summary.map(s => [s.label, s.value, s.key]), [
    ['Field reporting', '3 of 3', 'good'], ['Low battery', 1, 'low'], ['Field not reporting', 0, 'stale'], ['In shop', 2, 'shop']]);
});

test('a Field unit that stops reporting still counts, in amber', () => {
  const v = view([unit(1, 'field', 'good'), unit(2, 'field', 'stale'), unit(3, 'field', 'unavailable'), unit(4, 'shop', 'stale')]);
  assert.deepEqual(v.summary.map(s => [s.label, s.value, s.key]), [
    ['Field reporting', '1 of 3', 'good'], ['Low battery', 0, 'low'], ['Field not reporting', 2, 'fair'], ['In shop', 1, 'shop']]);
});

test('a Shop unit that is running is named, so it can be moved to Field in mHelp', () => {
  const v = view([unit(1, 'field', 'good'), unit(2, 'shop', 'good'), unit(3, 'shop', 'unavailable')]);
  assert.deepEqual(v.shopOn.map(u => u.name), ['HELIOS 002']);
  assert.deepEqual([...v.shopOff], []);   // running, or missing from the Victron sync: neither is "Not powered"
  assert.equal(v.summary[0].value, '1 of 1');
});

test('a unit mHelp cannot place is still counted, and the labels stop saying Field', () => {
  const v = view([unit(1, 'field', 'good'), unit(2, 'unknown', 'stale'), unit(3, 'shop', 'stale')]);
  assert.deepEqual(v.summary.map(s => [s.label, s.value]), [['Reporting', '1 of 2'], ['Low battery', 0], ['Not reporting', 1], ['In shop', 1]]);
  assert.deepEqual(v.ordered.map(u => u.installationId), [1, 2, 3]);
});

test('until mHelp is read, nothing changes: same order, every unit counted, the old labels', () => {
  const v = view([unit(1, 'unknown', 'good'), unit(2, 'unknown', 'stale'), unit(3, 'unknown', 'unavailable'), unit(4, 'unknown', 'none')]);
  assert.deepEqual(v.ordered.map(u => u.installationId), [1, 2, 3, 4]);
  assert.deepEqual(v.summary.map(s => [s.label, s.value]), [['Reporting', 1], ['Low battery', 0], ['Stale / no reading', 2], ['Unavailable', 1]]);
  assert.equal(v.placed, 0); assert.equal(v.shop.length, 0);
});
