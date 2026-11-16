import {test} from 'node:test';
import assert from 'node:assert/strict';
import {editLockReason} from '../src/editLockReason.ts';

test('an unconfirmed save says so and says to refresh', () => {
 const says=editLockReason({canEdit:true,handEditsRead:true},true);
 assert.match(says,/could not be confirmed/);
 assert.match(says,/refresh/i);
 assert.ok(!/Only you and IT/.test(says));
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

test('an unconfirmed save outranks the other reasons', () => {
 assert.match(editLockReason({canEdit:false,handEditsRead:false},true),/could not be confirmed/);
});

test('no report yet is not reported as a fault', () => {
 assert.equal(editLockReason(null,false),'Only you and IT can change a unit.');
});

test('every reason tells the person what to do next or who can do it', () => {
 for(const [report,uncertain] of [[{canEdit:true,handEditsRead:true},true],
                                  [{canEdit:true,handEditsRead:false},false],
                                  [{canEdit:false,handEditsRead:true},false]]){
  const says=editLockReason(report,uncertain);
  assert.ok(/Refresh|refresh|IT/.test(says),says);
  assert.ok(says.trim().endsWith('.'),says);
 }
});
