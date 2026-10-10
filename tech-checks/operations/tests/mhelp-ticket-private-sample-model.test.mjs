import test from 'node:test';import assert from 'node:assert/strict';import React from 'react';import {renderToStaticMarkup} from 'react-dom/server';import {readFileSync} from 'node:fs';
import {checkedMhelpTicketPrivateSample,checkedPrivateSampleRequest,privateSampleDateRange,privateSampleItemFields,privateSampleAppointmentFields,privateSampleStructureFields} from '../src/mhelpTicketPrivateSampleModel.ts';
import {projectMhelpPrivateSample,MHELP_PRIVATE_ITEM_FIELDS,MHELP_PRIVATE_APPOINTMENT_FIELDS,MHELP_PRIVATE_APPOINTMENT_VALUE_FIELDS} from '../../supabase/functions/cos-operations-pages/mhelpTicketPrivateSample.ts';
import {checkedMhelpTicketPreview} from '../src/mhelpTicketPreviewModel.ts';import MhelpTicketPreview from '../src/MhelpTicketPreview.tsx';import PrivateSample,{PrivateSampleResult} from '../src/MhelpTicketPrivateSample.tsx';import {createMhelpReadGuard} from '../src/mhelpReadGuard.ts';
import {privateTicketSampleFixture,privateSampleNow,privateSampleRequest,syntheticPrivateAppointment} from './fixtures/mhelpTicketPrivateSample.mjs';
const checked=v=>checkedMhelpTicketPrivateSample(v,v.request),html=v=>renderToStaticMarkup(React.createElement(PrivateSampleResult,{sample:checked(v)}));
const reject=v=>assert.throws(()=>checked(v));

test('private request, field sets and DTO match the explicit separate server contract',()=>{
 assert.deepEqual(privateSampleItemFields,MHELP_PRIVATE_ITEM_FIELDS);assert.deepEqual(privateSampleAppointmentFields,MHELP_PRIVATE_APPOINTMENT_VALUE_FIELDS);assert.deepEqual(privateSampleStructureFields,MHELP_PRIVATE_APPOINTMENT_FIELDS);assert.equal(privateSampleStructureFields.length,57);
 const value=privateTicketSampleFixture();assert.deepEqual(checked(value),projectMhelpPrivateSample(value));assert.equal(value.appointments.completeness,'unverified');assert.equal(value.appointments.rows.length,1);assert.throws(()=>checkedMhelpTicketPreview(value));
 for(const request of [{...privateSampleRequest,ticketNumber:'61043'},{...privateSampleRequest,appointmentDay:'2026-04-15'}])assert.throws(()=>checkedMhelpTicketPrivateSample(value,request));
 for(const file of ['mhelpTicketPrivateSampleModel.ts','MhelpTicketPrivateSample.tsx']){const source=readFileSync(new URL('../src/'+file,import.meta.url),'utf8');assert.doesNotMatch(source,/from ['"][^'"]*(?:supabase|mhelpTickets|mhelpToken)/);assert.doesNotMatch(source,/localStorage|sessionStorage|console\.|createObjectURL|download=|dangerouslySetInnerHTML|navigator\.clipboard/);}
});
test('date/request validation is exact, DST-safe and bounded to31 Chicago days',()=>{
 assert.deepEqual(checkedPrivateSampleRequest(privateSampleRequest,new Date(privateSampleNow)),privateSampleRequest);
 assert.deepEqual(privateSampleDateRange(new Date(privateSampleNow)),{min:'2026-03-15',max:'2026-05-16'});
 for(const day of ['2026-03-15','2026-05-16'])assert.doesNotThrow(()=>checkedPrivateSampleRequest({...privateSampleRequest,appointmentDay:day},new Date(privateSampleNow)));
 for(const request of [{...privateSampleRequest,ticketId:'88001'},{...privateSampleRequest,ticketNumber:'0'},{...privateSampleRequest,ticketNumber:'1e3'},{...privateSampleRequest,ticketNumber:' 61042 '},{...privateSampleRequest,ticketNumber:61042},{...privateSampleRequest,appointmentDay:'2026-03-14'},{...privateSampleRequest,appointmentDay:'2026-05-17'},{...privateSampleRequest,appointmentDay:'2026-02-30'},{...privateSampleRequest,appointmentDay:'2026-4-16'}])assert.throws(()=>checkedPrivateSampleRequest(request,new Date(privateSampleNow)));
 for(const [day,now,hours] of [['2026-03-08','2026-03-01T12:00:00.000Z',23],['2026-11-01','2026-10-20T12:00:00.000Z',25],['2026-12-31','2026-12-20T12:00:00.000Z',24]]){const value=privateTicketSampleFixture({request:{...privateSampleRequest,appointmentDay:day},now});assert.equal((Date.parse(value.window.endDateUtc)-Date.parse(value.window.startDateUtc))/3600000,hours);assert.deepEqual(checked(value),value);}
});
test('literal multiline text, numeric strings and mixed recorded quantities remain unclassified',()=>{
 const value=privateTicketSampleFixture(),rendered=html(value);
 assert.equal(checked(value).items.rows[0].fields.notes.value,'First line\n  Keep indentation & <tag> literally.\r\nLast line');assert.equal(checked(value).items.rows[1].fields.quantity.value,'12.00');
 assert(rendered.includes('Keep indentation &amp; &lt;tag&gt; literally.'));assert(rendered.includes('Earlier note: work on another day'));assert(rendered.includes('operator.synthetic@example.test'));assert(rendered.includes('7200'));
 for(const text of ['Recorded quantity (unclassified)','Recorded durationSeconds (unclassified)','not a count of physical units','No staff row, schedule, equipment assignment or work instruction is selected or rewritten','Source selection does not verify a native COS mapping','Coverage: unverified'])assert(rendered.includes(text),text);
 assert.doesNotMatch(rendered,/<tag>|excluded-rate|excluded-amount|excluded-tax|excluded-cost|excluded-contact|excluded-total|unmatched-private-content|conflicting-private-content/);
});
test('all structural descriptors remain available when no appointment values qualify',()=>{
 const value=privateTicketSampleFixture({appointments:{totalResults:3,results:[{},syntheticPrivateAppointment({ticketId:88002}),syntheticPrivateAppointment({portalId:73002})],unknownPrivate:'withheld'}}),rendered=html(value),a=value.appointments;
 assert.equal(a.rows.length,0);assert.equal(a.structure.emptyObjectRows,1);assert.equal(a.structure.suppressedEnvelopeKeys,1);assert.equal(a.structure.envelope.totalResults.integerCount,3);
 for(const text of ['No appointment values qualified','Root kind: object','Empty object rows: 1','Private sample fixed envelope descriptors','Private sample candidate identity comparisons','userId: email_like: 2'])assert(rendered.includes(text),text);
 assert.doesNotMatch(rendered,/unknownPrivate|withheld<|operator.synthetic@example.test|Earlier note/);
});
test('unavailable complete/incomplete/ambiguous selections expose bounded counts only',()=>{
 for(const [reason,selection] of [['ticket_not_found',{pageLimit:500,sampledTickets:1,reportedTotal:1,matchingTickets:0}],['ambiguous_ticket_number',{pageLimit:500,sampledTickets:2,reportedTotal:2,matchingTickets:2}],['incomplete_ticket_page',{pageLimit:500,sampledTickets:1,reportedTotal:3,matchingTickets:1}]]){
  const value=privateTicketSampleFixture({reason,selection});assert.deepEqual(checked(value),value);assert.match(html(value),/No ticket detail or appointments were read/);assert.match(html(value),/inspected tickets:/);assert(!Object.hasOwn(value,'items'));
 }
});
test('private nested DTO rejects extra fields, tampered identity, unsafe cells and forged claims',()=>{
 const original=privateTicketSampleFixture(),paths=[];const walk=(v,p=[])=>{if(v&&typeof v==='object'&&!Array.isArray(v)){paths.push(p);for(const [k,x]of Object.entries(v))walk(x,[...p,k]);}else if(Array.isArray(v))v.forEach((x,i)=>walk(x,[...p,i]));};walk(original);
 for(const path of paths){const value=structuredClone(original);path.reduce((v,k)=>v[k],value).raw='not allowed';reject(value);}
 for(const mutate of [v=>v.schema='verified',v=>v.identityMapping='verified',v=>v.ticketWrites=true,v=>v.selected.ticketNumber='61043',v=>v.window.calendarDays=7,v=>v.items.rows[0].fields.notes={state:'value',value:'password=synthetic-credential'},v=>v.items.rows[0].fields.name={state:'value',value:'x'.repeat(4001)},v=>v.items.rows[0].fields.quantity={state:'value',value:'4 units'},v=>v.appointments.rows[0].fields.ticketId.value=88002,v=>v.appointments.rows[0].fields.portalId.value='73001',v=>v.appointments.rows[0].fields.TicketId={state:'value',value:88002},v=>v.appointments.rows[0].fields.userId={state:'value',value:'Bearer syntheticsecret'},v=>v.appointments.rows[0].index=3,v=>v.appointments.matchingAppointments=0,v=>v.appointments.structure.emptyObjectRows=3,v=>v.appointments.structure.candidatePairs.matching[10]=9,v=>v.request.url='https://invalid.test',v=>v.items.rows.push(v.items.rows[0]),v=>v.items.rows[0].fields.notes={state:'value',value:'x'.repeat(262145)}]){const value=structuredClone(original);mutate(value);reject(value);}
});
test('opening private form is explicit and separate from unchanged aggregate controls',()=>{
 const privateMarkup=renderToStaticMarkup(React.createElement(PrivateSample)),aggregate=renderToStaticMarkup(React.createElement(MhelpTicketPreview));
 assert.match(privateMarkup,/Open private ticket inspection/);assert.doesNotMatch(privateMarkup,/<input|<table|<form/);assert.equal((aggregate.match(/<button\b/g)||[]).length,2);assert.doesNotMatch(aggregate,/ticket_private_sample_v1/);
 const source=readFileSync(new URL('../src/MhelpTicketPrivateSample.tsx',import.meta.url),'utf8');for(const boundary of ['COS_OPERATIONS_HIDE_PRIVATE_EVIDENCE','cos-workspace-navigation','hashchange','popstate','pagehide','visibilitychange','controller.current?.abort()','revision!==sequence.current','event.source===window.parent','event.origin===location.origin'])assert(source.includes(boundary),boundary);
 const css=readFileSync(new URL('../src/mhelpTicketPrivateSample.css',import.meta.url),'utf8');assert.match(css,/white-space:pre-wrap/);assert.doesNotMatch(source,/setInterval|setTimeout|\.get\(/);
});
test('UI lease prevents cross-view duplicate reads and ignores an older release after cancellation',()=>{
 const states=[],guard=createMhelpReadGuard(busy=>states.push(busy)),first=guard.acquire();assert.equal(typeof first,'symbol');assert.equal(guard.acquire(),null);guard.release(first);const second=guard.acquire();guard.release(first);assert.equal(guard.acquire(),null);guard.release(second);assert.deepEqual(states,[true,false,true,false]);
});

test('visible appointment proof must agree with all-row kinds, formats and exact pair counts on both sides',()=>{
 const original=privateTicketSampleFixture({appointments:{TotalRows:1,results:[syntheticPrivateAppointment()]}});
 const empty=privateTicketSampleFixture({appointments:{TotalRows:1,results:[{}]}});
 for(const mutate of [v=>v.appointments.structure=empty.appointments.structure,v=>v.appointments.structure.candidatePairs.matching.fill(0),v=>v.appointments.structure.fields.subject={kinds:{absent:1},formats:{},emptyStrings:0,nonemptyStrings:0},v=>v.appointments.structure.fields.startUtc.formats={other:1},v=>v.appointments.structure.aliasConflicts.user=1,v=>v.appointments.structure.userReferenceFormats.userId={numeric:1}]){
  const value=structuredClone(original);mutate(value);assert.throws(()=>projectMhelpPrivateSample(value));assert.throws(()=>checked(value));
 }
 assert.deepEqual(checked(original),original);
});

test('visible user-reference classes use the exact all-row diagnostic classifier without identity inference',()=>{
 for(const userId of ['112233','aaaaaaaa-bbbb-cccc-dddd-eeeeeeeeeeee','operator.synthetic@example.test','unresolved staff reference']){
  const value=privateTicketSampleFixture({appointments:{TotalRows:1,results:[syntheticPrivateAppointment({userId})]}});assert.deepEqual(projectMhelpPrivateSample(value),value);assert.deepEqual(checked(value),value);
 }
 const diagnostic=readFileSync(new URL('../../supabase/functions/cos-operations-pages/mhelpAppointmentVariants.ts',import.meta.url),'utf8'),privateSource=readFileSync(new URL('../../supabase/functions/cos-operations-pages/mhelpTicketPrivateSample.ts',import.meta.url),'utf8');
 const classifier=s=>s.match(/function userFormat\(value:string\)[\s\S]*?\n}/)[0];assert.equal(classifier(privateSource),classifier(diagnostic));
});
