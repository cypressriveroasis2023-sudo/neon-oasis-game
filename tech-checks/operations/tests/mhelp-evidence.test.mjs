import {test} from 'node:test';
import assert from 'node:assert/strict';
import {mhelpEvidenceByUnit,mhelpEvidenceFor} from '../src/mhelpEvidence.ts';
import {troubleshootUnit} from '../src/unitTroubleshoot.ts';

const row=(unitNumber,extra={})=>({unitNumber,placement:'FIELD',placementUpdatedAt:'2026-11-12T18:02:00Z',...extra});
const unit=(extra={})=>({unit:'SNIPER 302',displayName:'SNIPER 302',placement:'FIELD',site:'Bristol',
 state:'GREEN',cameras:1,online:1,offline:0,unknown:0,down:[],onlineInShop:false,
 publicIp:'198.51.100.7',observedAt:'2026-11-15T19:00:00Z',address:'1 Main St',
 location:{latitude:29.7,longitude:-95.4},...extra});
const mhelpCheck=r=>r.checks.find(c=>c.id==='mhelp');

test('mHelp placement is read and reported', () => {
 const i=mhelpEvidenceByUnit({units:[row('SNIPER 302')]});
 assert.equal(mhelpEvidenceFor(unit(),i).placement,'FIELD');
 const r=troubleshootUnit(unit(),{mhelp:mhelpEvidenceFor(unit(),i)});
 assert.equal(mhelpCheck(r).verdict,'pass');
 assert.match(mhelpCheck(r).detail,/Field in mHelp/);
});

test('a disagreement between mHelp and the board is surfaced, not hidden', () => {
 const i=mhelpEvidenceByUnit({units:[row('SNIPER 302',{placement:'SHOP'})]});
 const r=troubleshootUnit(unit(),{mhelp:mhelpEvidenceFor(unit(),i)});
 assert.equal(mhelpCheck(r).verdict,'warn');
 assert.match(mhelpCheck(r).detail,/mHelp says shop, the board shows field/);
 assert.equal(mhelpCheck(r).action.id,'placement');
});

test('a disagreement is what the advice tells you to fix first', () => {
 const i=mhelpEvidenceByUnit({units:[row('SNIPER 302',{placement:'SHOP'})]});
 const r=troubleshootUnit(unit({state:'RED',online:0,offline:1}),{mhelp:mhelpEvidenceFor(unit(),i)});
 assert.match(r.advice,/record of record/);
 assert.match(r.advice,/correct the placement before judging/);
});

test('a location held for review says why', () => {
 const i=mhelpEvidenceByUnit({units:[row('SNIPER 302',{mhelpLocationReviewReason:'address differs from source'})]});
 const r=troubleshootUnit(unit(),{mhelp:mhelpEvidenceFor(unit(),i)});
 assert.equal(mhelpCheck(r).verdict,'warn');
 assert.match(mhelpCheck(r).detail,/address differs from source/);
});

test('no mHelp row means no evidence, never a fault', () => {
 const i=mhelpEvidenceByUnit({units:[]});
 assert.equal(mhelpEvidenceFor(unit(),i),undefined);
 const r=troubleshootUnit(unit(),{});
 assert.equal(mhelpCheck(r).verdict,'unknown');
 assert.equal(r.failures,0);
});

test('a row with no placement recorded is Unknown, not Field', () => {
 const i=mhelpEvidenceByUnit({units:[row('SNIPER 302',{placement:null,placementStatus:null})]});
 const r=troubleshootUnit(unit(),{mhelp:mhelpEvidenceFor(unit(),i)});
 assert.equal(mhelpCheck(r).verdict,'unknown');
 assert.match(mhelpCheck(r).detail,/No placement recorded/);
});

test('one unit never picks up another unit\'s mHelp row', () => {
 const i=mhelpEvidenceByUnit({units:[row('SNIPER 303')]});
 assert.equal(mhelpEvidenceFor(unit(),i),undefined);
});

test('a malformed feed yields no evidence rather than guesses', () => {
 for(const bad of [null,undefined,{},{units:'nope'}])assert.equal(mhelpEvidenceByUnit(bad).size,0);
});

test('the confirmed date is shown as a date, not a timestamp', () => {
 const i=mhelpEvidenceByUnit({units:[row('SNIPER 302')]});
 const r=troubleshootUnit(unit(),{mhelp:mhelpEvidenceFor(unit(),i)});
 assert.match(mhelpCheck(r).detail,/confirmed 2026-11-12/);
 assert.ok(!/T18:02/.test(mhelpCheck(r).detail));
});
