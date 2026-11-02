import {originalBoardActionsMarkup} from './approved-board-actions-source.mjs';
import test from 'node:test';
import assert from 'node:assert/strict';
import {readFileSync} from 'node:fs';
import {createHash} from 'node:crypto';
import {boardRecordDetail,boardSavedInstant,boardRecordTime,captureBoardSelection} from '../src/boardRecordDetails.ts';

const jobId='11111111-1111-4111-8111-111111111111';
const visitId='22222222-2222-4222-8222-222222222222';
const taskId='33333333-3333-4333-8333-333333333333';
const otherId='44444444-4444-4444-8444-444444444444';
const instant='2026-11-02T13:01:02.123+00:00';
const job=(fields={})=>{const record={id:jobId,technician:'Example technician',notes:[],...fields};return {id:`job:${record.id}`,kind:'job',record};};
const task=(fields={})=>{const record={id:taskId,...fields};return {id:`task:${record.id}`,kind:'task',record};};
const visit=(fields={})=>job({id:`${jobId}:visit:${visitId}`,jobId,visitId,completionKind:'visit',completedAt:instant,...fields});
const read=name=>readFileSync(new URL('../src/'+name,import.meta.url),'utf8');

test('normal job links only its exact saved UUID',()=>assert.equal(boardRecordDetail(job()).jobId,jobId));
test('completed visit opens its explicit current job, never its synthetic visit id',()=>{
 const result=boardRecordDetail(visit());assert.equal(result.jobId,jobId);assert.equal(result.jobLinkLabel,'Open current job');assert.equal(result.completedAt,instant);
});
test('completed visit requires both supplied IDs and exact composite agreement',()=>{
 for(const fields of [{jobId:null},{visitId:null},{jobId:otherId},{visitId:otherId},{id:jobId},{id:`${jobId}:visit:${visitId}:extra`}])assert.equal(boardRecordDetail(visit(fields)).jobId,null);
});
test('missing explicit completed job ID is not recovered by parsing a composite string',()=>assert.equal(boardRecordDetail(visit({jobId:undefined})).jobId,null));
test('unknown completion kind does not reuse a possible job identifier',()=>assert.equal(boardRecordDetail(job({completionKind:'future-kind'})).jobId,null));
test('conflicting normal job ID fails closed',()=>assert.equal(boardRecordDetail(job({jobId:otherId})).jobId,null));
test('normal job may contain the same explicit job ID',()=>assert.equal(boardRecordDetail(job({jobId})).jobId,jobId));
test('mismatched card identity cannot generate a job link',()=>assert.equal(boardRecordDetail({...job(),id:`job:${otherId}`}).jobId,null));
test('non-UUID, whitespace, URL and route injection values do not become links',()=>{
 for(const id of ['',null,12,'Spotter 260',` ${jobId}`,`${jobId}?unit=123`,'https://example.invalid/x',jobId+'\n'])assert.equal(boardRecordDetail(job({id})).jobId,null);
});
test('task links only an exact related job, not its own ID',()=>{
 assert.equal(boardRecordDetail(task()).jobId,null);
 assert.equal(boardRecordDetail(task({relatedJobId:jobId})).jobId,jobId);
 assert.equal(boardRecordDetail(task({relatedJobId:jobId})).jobLinkLabel,'Open related job');
 assert.equal(boardRecordDetail(task({id:'invalid',relatedJobId:jobId})).jobId,null);
});
test('equipment tags and injected unit/product/IP fields never manufacture a unit binding',()=>{
 const result=boardRecordDetail(job({equipmentUnitTag:'Example 260',unitId:visitId,equipmentUnitId:visitId,productId:260,ip:'192.0.2.10'}));
 assert.equal(result.equipmentTag,'Example 260');assert.equal(result.unitId,null);assert.equal(result.jobId,jobId);
});
test('current job type and equipment model remain visible',()=>{
 const result=boardRecordDetail(job({jobType:'SERVICE',equipment:'Example model'}));assert.equal(result.jobType,'SERVICE');assert.equal(result.equipment,'Example model');
});
test('Owner Review grouping is not substituted for the saved assigned technician',()=>{
 const card={...job(),assignee:'Owner Review'};assert.equal(boardRecordDetail(card).responsible,'Example technician');
});
test('department assignment does not fabricate an individual technician',()=>assert.equal(boardRecordDetail(task({assignedTo:null,assignedDepartment:'it'})).responsible,'IT team'));
test('missing responsible person remains unassigned',()=>assert.equal(boardRecordDetail(job({technician:null})).responsible,'Unassigned'));
test('task instructions are recorded instructions, not derived from the latest note',()=>{
 const result=boardRecordDetail(task({instructions:'Inspect the recorded fault.',ownerNotes:'Review after field work.'}));
 assert.equal(result.instructions,'Inspect the recorded fault.');assert.equal(result.ownerNotes,'Review after field work.');
});
test('job next step is not invented from notes, statuses or unsupported instruction fields',()=>{
 const result=boardRecordDetail(job({status:'Dispatched',instructions:'Unsupported field',nextStep:'Invented',notes:[{text:'Prior work'}]}));
 assert.equal(result.instructions,null);assert.equal(result.notes[0].text,'Prior work');
});
test('job notes retain attribution, source order and original instants',()=>{
 const result=boardRecordDetail(job({notes:[{text:'First',by:'One',at:instant},{text:'Second',by:'Two',at:'2026-11-02T14:00:00Z'}]}));
 assert.deepEqual(result.notes.map(n=>n.text),['Second','First']);assert.equal(result.notes[1].at,instant);assert.equal(result.notes[0].author,'Two');
});
test('malformed and undated notes are not assigned fabricated timestamps or authors',()=>{
 const result=boardRecordDetail(job({notes:[null,{}, {text:42},{text:'Saved text'}, {text:'',at:instant}]}));
 assert.equal(result.notes.length,1);assert.equal(result.omittedNotes,4);assert.equal(result.notes[0].at,null);assert.equal(result.notes[0].author,'Author not supplied');
});
test('unavailable notes remain distinct from an empty successfully supplied notes array',()=>{
 assert.equal(boardRecordDetail(job({notes:undefined})).notesUnavailable,true);
 assert.equal(boardRecordDetail(job({notes:{}})).notesUnavailable,true);
 assert.equal(boardRecordDetail(job({notes:[]})).notesUnavailable,false);
});
test('completed-visit current-job notes and equipment are not represented as historical visit proof',()=>{
 const result=boardRecordDetail(visit());assert.match(result.historyLabel,/not visit-specific/);assert.match(result.equipmentLabel,/not visit evidence/);assert.match(result.responsibleLabel,/completed visit/);
});
test('started and completed times are drawn only from the appropriate saved task or visit fields',()=>{
 const result=boardRecordDetail(task({startedAt:instant,completedAt:'bad',updatedAt:'2026-11-02T15:00:00Z'}));
 assert.equal(result.startedAt,instant);assert.equal(result.completedAt,null);
 assert.equal(boardRecordDetail(job({completedAt:instant})).completedAt,null);
});
test('null and malformed records are safe empty presentation data',()=>{
 for(const record of [null,[],42,'bad',false]){const result=boardRecordDetail({id:'job:bad',kind:'job',record});assert.equal(result.jobId,null);assert.equal(result.responsible,'Unassigned');}
});
test('record snapshot timestamp stays attached to selection across later refreshes',()=>{
 const snapshot={asOf:instant};const card=job();const selected=captureBoardSelection(card,snapshot.asOf);
 snapshot.asOf='2026-11-02T14:00:00Z';assert.equal(selected.detailAsOf,instant);assert.equal(card.detailAsOf,undefined);assert.notEqual(selected,card);
});
test('missing snapshot time does not use the current clock or a camera timestamp',()=>{
 assert.equal(captureBoardSelection(job({lastOnlineAt:instant}),undefined).detailAsOf,null);
});
test('malformed and timezone-less instants remain unavailable',()=>{
 for(const value of [null,undefined,0,'2026-11-02','2026-11-02T10:00:00','2026-02-30T12:00:00Z','2026-13-01T12:00:00Z','2026-11-02T24:00:00Z','2026-11-02T12:60:00Z','2026-11-02T12:00:00+99:99'])assert.equal(boardSavedInstant(value),null);
 assert.equal(boardRecordTime('bad'),'Time not supplied');
});
test('explicit offset timestamps preserve original evidence and render in Central time',()=>{
 assert.equal(boardSavedInstant(instant),instant);assert.match(boardRecordTime(instant),/Nov 2, 2026/);assert.match(boardRecordTime(instant),/7:01:02 AM CST/);
});
test('Central daylight/standard ambiguity is made explicit without rewriting the instant',()=>{
 assert.match(boardRecordTime('2026-11-01T06:30:00Z'),/1:30:00 AM CDT/);
 assert.match(boardRecordTime('2026-11-01T07:30:00Z'),/1:30:00 AM CST/);
});
test('frozen source data and notes are not mutated',()=>{
 const note=Object.freeze({text:'Saved note',at:instant});const record=Object.freeze({id:jobId,notes:Object.freeze([note])});
 const card=Object.freeze({id:`job:${jobId}`,kind:'job',record});assert.doesNotThrow(()=>boardRecordDetail(card));assert.doesNotThrow(()=>captureBoardSelection(card,instant));
});
test('new view has no network, polling, write actions or automatic ticket creation',()=>{
 const source=read('BoardRecordDetails.tsx')+'\n'+read('boardRecordDetails.ts');
 assert.doesNotMatch(source,/\b(fetch|setInterval|setTimeout|localStorage|sessionStorage|dispatchEvent)\s*\(/);
 assert.doesNotMatch(source,/api\.(get|post)|createTicket|dangerouslySetInnerHTML/);
 assert.match(source,/workspaceHash\(\{workspace:'Jobs',jobId:detail.jobId,detail:false\}\)/);
 assert.match(source,/Unit not linked/);assert.match(source,/not a camera check time/);
});
test('DailyBoard non-presentation behavior reconstructs to the exact original blob',()=>{
 let source=originalBoardActionsMarkup(read('DailyBoard.tsx'));
 source=source.replace("\nimport BoardRecordDetails from './BoardRecordDetails';\nimport {captureBoardSelection} from './boardRecordDetails';",'');
 source=source.replace('useState<(BoardCard & {detailAsOf:string|null})|null>(null);','useState<BoardCard|null>(null);');
 source=source.replace('onClick={()=>setSelected(captureBoardSelection(card,snapshot.asOf))}','onClick={()=>setSelected(card)}');
 source=source.replace("      <BoardRecordDetails card={selected} sourceUnavailable={Boolean(error||stale)} close={()=>setSelected(null)}/>\n      {selected.record.completionKind!=='visit'&&<DeliveryGoBackSummary job={selected.record}/>}" ,
 "      <p>{selected.assignee} · {selected.status} · {boardDateLabel(selected.date)}</p>\n      <p>{selected.kind==='job'?[selected.record.jobType,selected.record.equipment,selected.record.equipmentUnitTag].filter(Boolean).join(' · '):selected.record.instructions||''}</p>\n      {selected.record.completionKind!=='visit'&&<DeliveryGoBackSummary job={selected.record}/>}\n      {jobNotes(selected)&&<p className='daily-board-detail-note'>{jobNotes(selected)}</p>}");
 const bytes=Buffer.from(source);assert.equal(createHash('sha1').update(`blob ${bytes.length}\0`).update(bytes).digest('hex'),'7ce8f38df99730e8bbe7f49eb65a221cc6c02cc7');
});
test('style changes are scoped and do not target Fleet or TV',()=>{
 const css=read('boardRecordDetails.css');assert.doesNotMatch(css,/cos-fleet|techcheck-tv|operations-sidebar|operations-bottom-nav/);
 assert.match(css,/min-height:48px/);assert.match(css,/@media\(max-width:700px\)/);
});
