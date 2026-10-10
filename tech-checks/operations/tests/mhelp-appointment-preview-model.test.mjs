import test from 'node:test';
import assert from 'node:assert/strict';
import React from 'react';
import {renderToStaticMarkup} from 'react-dom/server';
import {readFileSync} from 'node:fs';
import {checkedMhelpTicketPreview} from '../src/mhelpTicketPreviewModel.ts';
import {checkedMhelpAppointmentEvidence,ticketAppointmentEvidenceCapability,ticketAppointmentEvidenceFields,ticketAppointmentReviewKeys} from '../src/mhelpAppointmentPreviewModel.ts';
import MhelpTicketPreview,{MhelpAppointmentEvidence} from '../src/MhelpTicketPreview.tsx';
import {describeMhelpAppointments,projectMhelpAppointmentEvidence} from '../../supabase/functions/cos-operations-pages/mhelpAppointments.ts';
import {ticketPreviewFixture,ticketPreviewEvidenceFixture,ticketPreviewDetailFixture} from './fixtures/mhelpTicketPreview.mjs';
import {appointmentEvidenceFixture,syntheticAppointment} from './fixtures/mhelpAppointmentPreview.mjs';
import {ticketPreviewAppointmentFixture} from './fixtures/mhelpAppointmentTicketPreview.mjs';
const reject=value=>assert.throws(()=>checkedMhelpTicketPreview(value),error=>error.message==='The ticket preview response could not be verified. Try again.');
const html=evidence=>renderToStaticMarkup(React.createElement(MhelpAppointmentEvidence,{evidence}));

test('appointment capability retains all old DTOs and discloses the only fixed read before either button',()=>{
  assert.equal(ticketAppointmentEvidenceCapability,'appointment_structure_v1');
  for(const value of [ticketPreviewFixture(),ticketPreviewEvidenceFixture(),ticketPreviewDetailFixture(),ticketPreviewAppointmentFixture()])assert.deepEqual(checkedMhelpTicketPreview(value),value);
  const rendered=renderToStaticMarkup(React.createElement(MhelpTicketPreview)),disclosure=rendered.indexOf('seven-calendar-day scheduled period');
  assert(disclosure>=0&&disclosure<rendered.indexOf('<button'));
  for(const text of ['same server-selected ticket','selected creation-day midnight','America/Chicago','No appointments are read for empty or multiple-ticket windows','cannot enter dates, filters or URLs','does not require equipment or a Ticket Lead','Technicians choose the unit later','ticket notes hold the work instructions'])assert(rendered.includes(text),text);
  assert.equal((rendered.match(/<button\b/g)||[]).length,2);assert.doesNotMatch(rendered,/<input|<select|<textarea/);
  for(const file of ['mhelpAppointmentPreviewModel.ts','MhelpTicketPreview.tsx']){
    const source=readFileSync(new URL('../src/'+file,import.meta.url),'utf8');
    assert.doesNotMatch(source,/from ['"][^'"]*(?:supabase|mhelpTickets|mhelpToken)/);assert.doesNotMatch(source,/Authorization|accessToken|localStorage|sessionStorage|setInterval|setTimeout/);
  }
});
test('server-generated appointment projections and all selection counts roundtrip without source values',()=>{
  for(const count of [0,1,2,500]){
    const value=ticketPreviewAppointmentFixture({count}),evidence=checkedMhelpTicketPreview(value).appointmentEvidence;
    assert.deepEqual(evidence,value.appointmentEvidence);assert.deepEqual(projectMhelpAppointmentEvidence(evidence,count,value.window.createdAfter),evidence);
    assert.doesNotMatch(JSON.stringify(evidence),/synthetic-private|781234|991234|224643/);
    assert(Buffer.byteLength(JSON.stringify(evidence))<=16000);
  }
  const evidence=appointmentEvidenceFixture();assert.deepEqual(Object.keys(evidence.fields),[...ticketAppointmentEvidenceFields]);assert.deepEqual(Object.keys(evidence.reviewCounts),[...ticketAppointmentReviewKeys]);
  for(const count of [0,2])assert.match(html(appointmentEvidenceFixture({count})),/No appointments were read/);
  assert.match(html(),/Appointment evidence is unavailable/);
});
test('appointments require the preceding detail and operational evidence but never change older clients',()=>{
  for(const remove of ['detailEvidence','operationalEvidence']){const value=ticketPreviewAppointmentFixture();delete value[remove];reject(value);}
  for(const appointmentEvidence of [null,undefined,false,[],{},'synthetic-private'])reject({...ticketPreviewDetailFixture(),appointmentEvidence});
  for(const [count,evidenceCount] of [[0,1],[1,0],[1,2],[2,1],[0,2],[2,0]]){
    const value=ticketPreviewAppointmentFixture({count});value.appointmentEvidence=appointmentEvidenceFixture({count:evidenceCount});reject(value);
  }
});
test('seven Chicago calendar days validate over spring, fall, year boundaries and reject arbitrary date windows',()=>{
  for(const [createdAfter,endDateUtc,hours] of [['2026-03-07T06:00:00.000Z','2026-03-14T05:00:00.000Z',167],['2026-10-31T05:00:00.000Z','2026-11-07T06:00:00.000Z',169],['2026-12-29T06:00:00.000Z','2027-01-05T06:00:00.000Z',168]]){
    const evidence=appointmentEvidenceFixture({createdAfter,appointments:[]});
    assert.deepEqual(checkedMhelpAppointmentEvidence(evidence,1,createdAfter),evidence);assert.equal(evidence.window.endDateUtc,endDateUtc);assert.equal((Date.parse(endDateUtc)-Date.parse(createdAfter))/3600000,hours);
    const rendered=html(evidence);assert.match(rendered,/7 calendar days in America\/Chicago/);assert.match(rendered,/end excluded/);
  }
  for(const mutation of [e=>{e.window.startDateUtc='2026-10-10T05:00:00.000Z';},e=>{e.window.endDateUtc='2026-10-15T05:00:00.000Z';},e=>{e.window.endDateUtc='2026-10-16T05:00:00Z';},e=>{e.window.timeZone='UTC';},e=>{e.window.calendarDays=6;},e=>{e.window.ticketId='synthetic-private';}]){
    const value=ticketPreviewAppointmentFixture();mutation(value.appointmentEvidence);reject(value);
  }
  const value=ticketPreviewAppointmentFixture();value.window.createdAfter='2026-10-09T05:01:00.000Z';value.appointmentEvidence.window.startDateUtc=value.window.createdAfter;reject(value);
});
test('complete, empty, incomplete, ambiguous and review states never establish a schedule or technician',()=>{
  const cases=[
    [{},'single_structural_match','One structural match was found'],
    [{appointments:[]},'no_match_in_window','An appointment may exist outside this period'],
    [{appointments:[syntheticAppointment({TicketId:123})]},'no_match_in_window','scheduling status remains unverified'],
    [{reportedTotal:2},'unverified','appointment page is incomplete'],
    [{appointments:[syntheticAppointment(),syntheticAppointment({ID:991235})]},'ambiguous_matches','Multiple structural matches'],
    [{appointments:[syntheticAppointment({TicketId:'781234'})]},'unverified','Ticket-to-appointment linkage remains unverified'],
  ];
  for(const [options,linkage,text] of cases){const value=ticketPreviewAppointmentFixture(options),evidence=checkedMhelpTicketPreview(value).appointmentEvidence;assert.equal(evidence.linkage,linkage);assert(html(evidence).includes(text));assert.doesNotMatch(html(evidence),/unscheduled|synthetic-private|2026-10-11T12:00/);}
  for(const [change,key] of [[{IsDeleted:true},'deleted'],[{IsHidden:true},'hidden'],[{TeamId:7},'team'],[{RecurrenceRule:'synthetic-private'},'recurrence'],[{IsHidden:undefined},'missingFlags'],[{UserId:null},'missingUser'],[{StartUTC:'2026-10-11T12:00:00'},'invalidTime'],[{ID:null},'invalidIdentity']]){
    const evidence=checkedMhelpTicketPreview(ticketPreviewAppointmentFixture({appointments:[syntheticAppointment(change)]})).appointmentEvidence;
    assert.equal(evidence.linkage,'review_required');assert.equal(evidence.reviewCounts[key],1);assert.match(html(evidence),/structural match requires review/);assert.doesNotMatch(html(evidence),/synthetic-private/);
  }
  const evidence=describeMhelpAppointments({totalRows:1,data:[syntheticAppointment()]},{ticketId:'781234',portalId:'224643',deleted:false},'2026-10-09T05:00:00.000Z');
  assert.equal(checkedMhelpAppointmentEvidence(evidence,1,evidence.window.startDateUtc).completeness,'unverified');assert.match(html(evidence),/envelope is unverified/);
});
test('all nested key allowlists reject source values, unknown and removed keys with redacted errors',()=>{
  const paths=[];const walk=(value,path=[])=>{if(value&&typeof value==='object'){paths.push(path);for(const [key,child] of Object.entries(value))walk(child,[...path,key]);}};
  walk(appointmentEvidenceFixture());
  for(const path of paths){const value=ticketPreviewAppointmentFixture();path.reduce((row,key)=>row[key],value.appointmentEvidence)['synthetic-private']='secret@example.test';reject(value);}
  for(const path of [[],['window'],['envelope'],['fields'],['fields','UserId'],['reviewCounts']]){
    const original=appointmentEvidenceFixture(),keys=Object.keys(path.reduce((row,key)=>row[key],original));
    for(const key of keys){const value=ticketPreviewAppointmentFixture();delete path.reduce((row,key)=>row[key],value.appointmentEvidence)[key];reject(value);}
  }
  for(const count of [0,2])for(const mutate of [e=>{e.fields={};},e=>{e.reason=count?'empty_window':'ambiguous_window';},e=>{delete e.window;},e=>{e.reason='synthetic-private';}]){const value=ticketPreviewAppointmentFixture({count});mutate(value.appointmentEvidence);reject(value);}
});
test('forged linkage, envelope consistency and impossible counters cannot promote candidate evidence',()=>{
  for(const mutate of [
    e=>{e.contract='other';},e=>{e.scope='all_tickets';},e=>{e.state='verified';},e=>{e.pageLimit=501;},e=>{e.sampledAppointments=501;},e=>{e.sampledAppointments=1.5;},
    e=>{e.reportedTotal=1000001;},e=>{e.reportedTotal='1';},e=>{e.completeness='incomplete';},e=>{e.envelope.resultsKind='object';},e=>{e.envelope.totalRowsKind='string';},
    e=>{e.envelope.alternateDataKind='array';},e=>{e.fields.UserId.kinds={string:2};},e=>{e.fields.UserId.kinds={string:1,absent:0};},e=>{e.fields.UserId.formats={other:2};},
    e=>{e.fields.UserId.formats={secret:1};},e=>{e.fields.UserId.nonemptyStrings=0;},e=>{e.fields.UserId.emptyStrings=-1;},e=>{e.fields.ID.kinds={integer:'1'};},
    e=>{e.exactMatchCount=2;},e=>{e.unverifiedLinkageCount=1;},e=>{e.fields.TicketId.kinds={string:1};e.fields.TicketId.formats={numeric:1};e.fields.TicketId.nonemptyStrings=1;},
    e=>{e.linkage='no_match_in_window';},e=>{e.linkage='scheduled';},e=>{e.reviewCounts.hidden=1;},e=>{e.reviewCounts.hidden=-1;},e=>{e.reviewCounts.hidden=2;},e=>{e.technician='synthetic-private';},e=>{e.schedule='verified';},e=>{e.fields.UserId.raw='x'.repeat(16001);},
  ]){const value=ticketPreviewAppointmentFixture();mutate(value.appointmentEvidence);reject(value);}
  const value=ticketPreviewAppointmentFixture({reportedTotal:2});value.appointmentEvidence.linkage='single_structural_match';reject(value);
});
test('page counts up to 500 roundtrip and match distributions remain bounded independently',()=>{
  for(const size of [0,1,49,50,51,499,500]){
    const appointments=Array.from({length:size},(_,index)=>syntheticAppointment({ID:991234+index})),value=ticketPreviewAppointmentFixture({appointments});
    const evidence=checkedMhelpTicketPreview(value).appointmentEvidence;assert.equal(evidence.sampledAppointments,size);assert.equal(evidence.fields.ID.kinds.integer,size||undefined);assert.equal(evidence.exactMatchCount,size);
  }
});
test('appointment browser cases remain in the exact-head hosted pre-publication CI gate',()=>{
  const yaml=readFileSync(new URL('../../../.github/workflows/cos-operations.yml',import.meta.url),'utf8');
  assert.match(yaml,/Verify mHelp Owner, IT and Service interactions before the full browser suite[\s\S]*npm run test:browser -- tests\/mhelp-intake-review.browser.spec.mjs tests\/mhelp-ticket-preview.browser.spec.mjs tests\/it-ticket-instructions.browser.spec.mjs tests\/service-ticket-instructions.browser.spec.mjs tests\/legacy-install-evidence.browser.spec.mjs/);
  const spec=readFileSync(new URL('./mhelp-ticket-preview.browser.spec.mjs',import.meta.url),'utf8');assert.match(spec,/appointment.*seven-day/);assert.doesNotMatch(yaml,/continue-on-error: true/);
});
