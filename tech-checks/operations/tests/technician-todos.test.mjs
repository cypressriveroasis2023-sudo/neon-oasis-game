import test from 'node:test';
import assert from 'node:assert/strict';
import {technicianTodos} from '../src/technicianTodos.ts';
import TechnicianTodoList from '../src/TechnicianTodoList.tsx';

const clear = {voltage: 'clear', soc: 'clear', silent: 'clear', victronLowVoltage: 'clear'};

test('the phone list is a component and not a vendor write', () => {
  assert.equal(typeof TechnicianTodoList, 'function');
});

test('a confirmed offline field camera is a job', () => {
  const todos = technicianTodos({cameras: [{unit: 'HELIOS 12', placement: 'FIELD', state: 'RED', offline: 2, online: 0, unknown: 0}]});
  assert.equal(todos.length, 1);
  assert.equal(todos[0].kind, 'camera_offline');
  assert.match(todos[0].detail, /2 confirmed cameras offline/);
});

test('unknown, green, and shop units are not jobs', () => {
  const todos = technicianTodos({cameras: [
    {unit: 'HELIOS 1', placement: 'FIELD', state: 'UNKNOWN', offline: 0, unknown: 4},
    {unit: 'HELIOS 2', placement: 'FIELD', state: 'YELLOW', offline: 0, online: 1, unknown: 1},
    {unit: 'HELIOS 3', placement: 'FIELD', state: 'GREEN', offline: 0, online: 2},
    {unit: 'SHOP 4', placement: 'SHOP', state: 'RED', offline: 3},
  ]});
  assert.deepEqual(todos, []);
});

test('a COS battery alarm and a silent feed are jobs; unknown power is not', () => {
  const todos = technicianTodos({power: [
    {unit: 'HELIOS 8', placement: 'FIELD', verdict: {...clear, voltage: 'alarm'}},
    {unit: 'HELIOS 9', placement: 'FIELD', verdict: {...clear, silent: 'alarm'}},
    {unit: 'HELIOS 10', placement: 'FIELD', verdict: {...clear, voltage: 'unknown', soc: 'unset'}},
    {unit: 'SHOP 1', placement: 'SHOP', verdict: {...clear, voltage: 'alarm', silent: 'alarm'}},
  ]});
  assert.deepEqual(todos.map(todo => todo.kind), ['battery_alarm', 'power_silent']);
  assert.match(todos[0].detail, /separate check/);
});

test('an ungeocodable address is a read-only mHelp fix, and a shop address is not', () => {
  const todos = technicianTodos({addresses: [
    {unit: 'CAMV 4', productId: 'p1', placement: 'FIELD'},
    {unit: 'SHOP 2', productId: 'p2', placement: 'SHOP'},
  ]});
  assert.equal(todos.length, 1);
  assert.equal(todos[0].kind, 'mhelp_address');
  assert.match(todos[0].detail, /Fix it in mHelpDesk/);
  assert.match(todos[0].detail, /does not write/);
});

test('a complete address stays off the fix-mHelp wording until both lookups fail', () => {
  const address = '2850 Twinwood Pkwy, Brookshire, TX 77423';
  const open = technicianTodos({addresses: [{unit: 'SOLAR SPOTTER 12', productId: 'p9', placement: 'FIELD', address}]});
  assert.match(open[0].detail, /couldn't be mapped automatically/);
  assert.doesNotMatch(open[0].detail, /Fix it in mHelpDesk/);
  const failed = technicianTodos({addresses: [{unit: 'SOLAR SPOTTER 12', productId: 'p9', placement: 'FIELD', address, bothLookupsFailed: true}]});
  assert.match(failed[0].detail, /Fix it in mHelpDesk/);
});
