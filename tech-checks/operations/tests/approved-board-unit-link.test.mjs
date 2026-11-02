import test from 'node:test';
import assert from 'node:assert/strict';
import {readFileSync} from 'node:fs';
import {createHash} from 'node:crypto';
import {createElement} from 'react';
import {renderToStaticMarkup} from 'react-dom/server';
import {approvedBoardUnitTarget} from '../src/approvedBoardUnitLink.ts';
import ApprovedBoardUnitLink from '../src/ApprovedBoardUnitLink.tsx';
import {resolveBoardUnitLink} from '../proposals/board-unit-link/resolveBoardUnitLink.ts';
import {fixture,JOB,UNIT,ASSIGN,VISIT,TASK,ASOF,OBS,PID} from '../proposals/board-unit-link/fixtures.mjs';

const base=(fields={})=>{const record={id:JOB,notes:[],...fields};return {id:`job:${record.id}`,kind:'job',record,detailAsOf:ASOF};};
const linked=()=>{const card=base();card.record.unitLink=resolveBoardUnitLink(card.kind,card.record,fixture());assert.equal(card.record.unitLink.state,'linked');return card;};
const read=name=>readFileSync(new URL('../src/'+name,import.meta.url),'utf8');

test('the actual server candidate connects to the existing exact Fleet route',()=>{
 const target=approvedBoardUnitTarget(linked(),false);assert.deepEqual(target,{href:'#fleet-dashboard?unit='+UNIT,productId:PID,observedAt:OBS,completedVisit:false});
});
test('full card identity is checked as well as the saved job ID',()=>{
 const card=linked();card.id='job:'+TASK;assert.equal(approvedBoardUnitTarget(card,false),null);
});
test('a valid metadata contract never overrides unavailable Board source',()=>assert.equal(approvedBoardUnitTarget(linked(),true),null));
test('native unit ID, tag, IP, and product fields without metadata cannot make a shortcut',()=>{
 assert.equal(approvedBoardUnitTarget(base({unitId:UNIT,equipmentUnitId:UNIT,equipmentUnitTag:'Spotter 260',ip:'192.0.2.1',productId:PID}),false),null);
});
for(const [field,values] of Object.entries({
 contract:[undefined,'wrong'],state:['not_linked','held','unknown'],basis:['historical_visit','name_match'],
 jobId:[TASK,null],recordContext:['completed_visit_current_job','task_related_job'],
 unitId:[null,'00000000-0000-0000-0000-000000000000',UNIT+'?create=service','https://example.invalid',' '+UNIT],
 assignmentId:[undefined,'Spotter 260'],productId:[42,'0','001','123&unit=x'],sourceSha256:['','A'.repeat(64)],
 assignmentAsOf:['2026-02-30T12:00:00Z','2026-11-02T19:00:01Z'],
 fleetAsOf:['2026-11-02T19:00:00','2026-11-02T19:00:01Z'],
 productObservedAt:['2026-11-02T19:00:01Z','not a time']
}))test(`invalid ${field} never renders a unit route`,()=>{for(const value of values){const card=linked();card.record.unitLink[field]=value;assert.equal(approvedBoardUnitTarget(card,false),null,String(value));}});
for(const invalid of [undefined,null,[],false,0,'not a contract'])test('nonobject/missing metadata remains unavailable: '+String(invalid),()=>{
 const card=linked();card.record.unitLink=invalid;assert.equal(approvedBoardUnitTarget(card,false),null);
});
test('missing or invalid captured snapshot time is not replaced with the clock',()=>{
 for(const at of [null,'','2026-11-02T18:58:00Z','invalid'])assert.equal(approvedBoardUnitTarget({...linked(),detailAsOf:at},false),null);
});
test('completed visit requires its own context and opens CURRENT job equipment',()=>{
 const card=base({id:`${JOB}:visit:${VISIT}`,jobId:JOB,visitId:VISIT,completionKind:'visit'});
 card.record.unitLink=resolveBoardUnitLink('job',card.record,fixture());
 assert.equal(approvedBoardUnitTarget(card,false).completedVisit,true);
 assert.equal(approvedBoardUnitTarget(card,false).href,'#fleet-dashboard?unit='+UNIT);
 card.record.unitLink.recordContext='job';assert.equal(approvedBoardUnitTarget(card,false),null);
});
test('related task resolves only explicit saved job and task-specific metadata',()=>{
 const card={id:'task:'+TASK,kind:'task',record:{id:TASK,relatedJobId:JOB},detailAsOf:ASOF};
 card.record.unitLink=resolveBoardUnitLink('task',card.record,fixture());
 assert.equal(approvedBoardUnitTarget(card,false).href,'#fleet-dashboard?unit='+UNIT);
 card.record.relatedJobId=ASSIGN;assert.equal(approvedBoardUnitTarget(card,false),null);
});
test('held server result remains held without replacing any source values',()=>{
 const f=fixture();f.fleet.value.uploadInventory.records[0].binding.placementHeld=true;
 const card=base();card.record.unitLink=resolveBoardUnitLink('job',card.record,f);
 assert.equal(card.record.unitLink.state,'not_linked');assert.equal(approvedBoardUnitTarget(card,false),null);
});
test('reading a deeply frozen card does not mutate the source',()=>{
 const card=linked();Object.freeze(card.record.unitLink);Object.freeze(card.record);Object.freeze(card);
 assert.doesNotThrow(()=>approvedBoardUnitTarget(card,false));
});
test('rendered link is ordinary navigation with no new job action',()=>{
 const html=renderToStaticMarkup(createElement(ApprovedBoardUnitLink,{card:linked(),sourceUnavailable:false,close:()=>{},children:'original fallback'}));
 assert.match(html,new RegExp('href="#fleet-dashboard\\?unit='+UNIT+'"'));assert.match(html,/Open unit/);
 assert.match(html,/not a camera check time/);assert.doesNotMatch(html,/original fallback|camera online|create=/i);
});
test('missing data and source failures render original fallback verbatim',()=>{
 for(const [card,sourceUnavailable]of [[base(),false],[linked(),true]])assert.equal(renderToStaticMarkup(createElement(ApprovedBoardUnitLink,{card,sourceUnavailable,close:()=>{},children:createElement('p',null,'Original Unit not linked')})),'<p>Original Unit not linked</p>');
});
test('original entire Board details component reconstructs after declared wrapper reversal',()=>{
 let source=read('BoardRecordDetails.tsx').replace("import ApprovedBoardUnitLink from './ApprovedBoardUnitLink';\n",'');
 source=source.replace('    <ApprovedBoardUnitLink card={card} sourceUnavailable={sourceUnavailable} close={close}>\n','').replace('    </ApprovedBoardUnitLink>\n','');
 const b=Buffer.from(source);assert.equal(createHash('sha1').update(`blob ${b.length}\0`).update(b).digest('hex'),'b5b76d5312cffda72c6a6204560dab32044ef663');
});
test('new UI never imports server resolver or starts reads, timers, writes or identity guesses',()=>{
 const source=read('ApprovedBoardUnitLink.tsx')+read('approvedBoardUnitLink.ts');
 assert.doesNotMatch(source,/\b(fetch|setInterval|setTimeout|Date\.now|dispatchEvent)\s*\(|api\.(get|post)|localStorage|sessionStorage|proposals\/|dangerouslySetInnerHTML/);
 assert.doesNotMatch(source,/equipmentUnitTag|unitNumber|customer|publicIp|uploadProductId/);
});
