import test from 'node:test';
import assert from 'node:assert/strict';
import {readFileSync} from 'node:fs';
import {approvedPrimaryAreas,approvedArea} from '../src/approvedCosNavigation.ts';
const read=name=>readFileSync(new URL('../src/'+name,import.meta.url),'utf8');

test('approved selection opts out of legacy generic active rules without touching global theme',()=>{
 const component=read('ApprovedCosNavigation.tsx');
 assert.match(component,/className=\{approvedArea\(active\)===area.workspace\?'cos-approved-selected':''\}/);
 assert.doesNotMatch(component,/\?'active':''/);
 assert.match(component,/aria-current=\{approvedArea\(active\)===area.workspace\?'page':undefined\}/);
 assert.match(component,/onClick=\{\(\)=>navigate\(area.workspace\)\}/);
});
test('both approved primary navigation layouts use the same selected style',()=>{
 const css=read('approvedCosNavigation.css');
 assert.match(css,/operations-area-nav button\.cos-approved-selected/);
 assert.match(css,/operations-bottom-nav > button\.cos-approved-selected/);
 assert.doesNotMatch(css,/#root#root|button\.active/);
 assert.equal((css.match(/background:var\(--approved-red\) !important|background: var\(--approved-red\) !important/g)||[]).length,2);
});
test('selection remains presentation only across the four destinations',()=>{
 assert.deepEqual(approvedPrimaryAreas.map(x=>x.workspace),['Fleet Dashboard','Tech Check','Team','Operations']);
 assert.equal(approvedArea('Camera Health'),'Fleet Dashboard');
 assert.equal(approvedArea('Daily Board'),'Operations');
 assert.equal(approvedArea('Owner Tasks'),'Operations');
});

test('work dialog layout is selected by its existing record view, not by altering Board behavior',()=>{
 const source=read('DailyBoard.tsx');
 assert.match(source,/className='daily-board-detail' aria-label='Work details'/);
 assert.match(source,/className='daily-board-detail daily-board-assignment'/);
 assert.doesNotMatch(source,/cos-board-record-dialog/);
 const css=read('boardRecordDetails.css');
 assert.match(css,/\.daily-board-detail:has\(\.cos-board-record\)\s*\{[^}]*inset:0; margin:auto;/);
 assert.match(css,/max-height:calc\(100dvh - 32px\)/);
 assert.doesNotMatch(css,/daily-board-assignment|techcheck-tv|cos-fleet/);
});
test('work dialog hides when closed and keeps a 48px sticky close target',()=>{
 const css=read('boardRecordDetails.css');
 assert.match(css,/:has\(\.cos-board-record\):not\(\[open\]\)\s*\{display:none;/);
 assert.match(css,/button:first-child\s*\{[^}]*position:sticky; top:0;[^}]*min-height:48px!important;/);
});
