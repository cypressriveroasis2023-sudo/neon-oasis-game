import test from 'node:test';
import assert from 'node:assert/strict';
import {calendarDays,moveCalendar} from '../src/operationsWorkflowData.ts';

test('COS calendar Day view shows only the selected saved schedule date',()=>{
  assert.deepEqual(calendarDays('2026-10-22','Day'),['2026-10-22']);
  assert.deepEqual(calendarDays('2026-10-22','Week').length,7);
  assert.equal(calendarDays('2026-10-22','Month').length,42);
});
test('Day arrows cross month and year boundaries without shifting schedule dates',()=>{
  assert.equal(moveCalendar('2026-10-31','Day',1),'2026-11-01');
  assert.equal(moveCalendar('2026-01-01','Day',-1),'2025-12-31');
  assert.equal(moveCalendar('2026-12-31','Day',1),'2027-01-01');
});
test('Day cursor rejects invented or invalid dates',()=>{
  assert.throws(()=>calendarDays('2026-02-30','Day'),/valid calendar day/);
  assert.throws(()=>moveCalendar('not a date','Day',1),/valid calendar day/);
});
