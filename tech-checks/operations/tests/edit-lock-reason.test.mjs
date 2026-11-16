import {test} from 'node:test';
import assert from 'node:assert/strict';
import {readFileSync} from 'node:fs';
import {editLockReason} from '../src/editLockReason.ts';

test('an unconfirmed save adds nothing: its own alert already says it', () => {
 // The panel raises an alert for an unconfirmed save. A second sentence here
 // puts the same message on screen twice and reads as two separate faults.
 assert.equal(editLockReason({canEdit:true,handEditsRead:true},true),'');
});

test('unreadable hand edits are named as that, not as a permission', () => {
 const says=editLockReason({canEdit:true,handEditsRead:false},false);
 assert.match(says,/saved hand edits could not be read/);
 assert.match(says,/Refresh/);
 // Telling IT that only IT may edit sends them looking for someone else.
 assert.ok(!/Only you and IT/.test(says));
});

test('a real permission limit still says so plainly', () => {
 assert.equal(editLockReason({canEdit:false,handEditsRead:true},false),'Only you and IT can change a unit.');
});

test('an unconfirmed save stays silent even when another reason also applies', () => {
 assert.equal(editLockReason({canEdit:false,handEditsRead:false},true),'');
});

test('no report yet is not reported as a fault', () => {
 assert.equal(editLockReason(null,false),'Only you and IT can change a unit.');
});

test('every reason it does give says what to do next or who can do it', () => {
 for(const [report,uncertain] of [[{canEdit:true,handEditsRead:false},false],
                                  [{canEdit:false,handEditsRead:true},false]]){
  const says=editLockReason(report,uncertain);
  assert.ok(/Refresh|refresh|IT/.test(says),says);
  assert.ok(says.trim().endsWith('.'),says);
 }
});

test('the panel never prints an empty reason line', () => {
 const screen=readFileSync(new URL('../src/FleetCameraStatus.tsx',import.meta.url),'utf8');
 assert.match(screen,/!canEdit&&editLockReason\(report,uncertain\)&&<p/);
});
