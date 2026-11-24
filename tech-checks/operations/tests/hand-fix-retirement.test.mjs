import assert from 'node:assert/strict';
import test from 'node:test';
import {RETIRABLE_FIELDS, handFixRetirement, retiredFields} from '../shared/handFixRetirement.ts';

const FIX = '2026-11-23T14:00:00Z';
const ask = (field, mhelpPlacement, mhelpObservedAt, fixedAt = FIX) =>
  handFixRetirement({field, fixedAt, mhelpPlacement, mhelpObservedAt});

test('a placement fix retires once mHelp sees the unit in the shop after it was made', () => {
  const out = ask('placement', 'SHOP', '2026-11-23T18:00:00Z');
  assert.equal(out.retired, true);
  assert.match(out.reason, /back in the shop after the fix/);
  assert.equal(ask('site', 'SHOP', '2026-11-23T18:00:00Z').retired, true);
});

test('mHelp being behind never retires a fix', () => {
  // The reading is older than the fix: this is the case hand fixes exist for.
  assert.equal(ask('placement', 'SHOP', '2026-11-23T09:00:00Z').retired, false);
  assert.equal(ask('placement', 'SHOP', FIX).retired, false);
  assert.match(ask('placement', 'SHOP', '2026-11-23T09:00:00Z').reason, /still stands/);
});

test('an IP or address fix never retires, however late the reading', () => {
  for (const field of ['public_ip', 'address', 'name', 'camera']) {
    const out = ask(field, 'SHOP', '2027-01-01T00:00:00Z');
    assert.equal(out.retired, false, field);
    assert.match(out.reason, /stands until someone undoes it|does not have this unit/);
  }
  assert.deepEqual([...RETIRABLE_FIELDS], ['placement', 'site']);
});

test('mHelp still having the unit in the field retires nothing', () => {
  assert.equal(ask('placement', 'FIELD', '2026-11-23T18:00:00Z').retired, false);
  assert.equal(ask('placement', null, '2026-11-23T18:00:00Z').retired, false);
});

test('a missing or unreadable time never retires a fix', () => {
  for (const observed of [null, undefined, '', '   ', 'not a date'])
    assert.equal(ask('placement', 'SHOP', observed).retired, false, String(observed));
  // Called directly: a default argument would stand in for undefined and hide the case.
  for (const fixed of [null, undefined, '', 'nonsense'])
    assert.equal(handFixRetirement({
      field: 'placement', fixedAt: fixed, mhelpPlacement: 'SHOP', mhelpObservedAt: '2026-11-23T18:00:00Z',
    }).retired, false, 'fixedAt ' + String(fixed));
});

test('a unit reports only the fixes a later reading retired', () => {
  const fixes = [
    {field: 'placement', fixedAt: FIX},
    {field: 'site', fixedAt: FIX},
    {field: 'public_ip', fixedAt: FIX},
    {field: 'placement', fixedAt: '2026-11-23T20:00:00Z'},
  ];
  const mhelp = {placement: 'SHOP', observedAt: '2026-11-23T18:00:00Z'};
  assert.deepEqual(retiredFields(fixes, mhelp), ['placement', 'site']);
  assert.deepEqual(retiredFields(fixes, {placement: 'FIELD', observedAt: '2026-11-23T18:00:00Z'}), []);
  assert.deepEqual(retiredFields([], mhelp), []);
});
