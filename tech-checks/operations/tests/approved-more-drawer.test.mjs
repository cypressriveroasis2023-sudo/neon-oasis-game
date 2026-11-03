import test from 'node:test';
import assert from 'node:assert/strict';
import {readFileSync} from 'node:fs';
import {addition,verify} from './approved-more-drawer-source.mjs';
test('phone More fix retains every original navigation style byte',()=>{
 verify(readFileSync(new URL('../src/approvedCosNavigation.css',import.meta.url),'utf8'));
});
test('duplicate primary row is hidden only in the approved Owner phone drawer',()=>{
 assert.match(addition,/@media \(max-width:700px\)/);
 assert.match(addition,/#root \.operations-shell\.cos-approved-shell > \.operations-sidebar\.operations-sidebar-open > \.operations-area-nav/);
 assert.equal((addition.match(/display:none/g)||[]).length,1);
 assert.doesNotMatch(addition,/operations-bottom-nav|cos-fleet|cos-tv|login|content:|visibility:|pointer-events:/);
});
test('shared phone acceptance retains route, keyboard focus and duplicate-menu checks',()=>{
 const text=readFileSync(new URL('./approved-shell-acceptance.mjs',import.meta.url),'utf8');
 assert.match(text,/expect\(dialog\.locator\('\.operations-area-nav'\)\)\.toBeHidden\(\)/);
 assert.match(text,/toBe\(priorHash\)/);
 assert.match(text,/toBeFocused\(\)/);
 assert.doesNotMatch(text,/force:true|location\.hash\s*=|location\.href\s*=/);
});
