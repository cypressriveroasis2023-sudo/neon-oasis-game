import test from 'node:test';
import assert from 'node:assert/strict';
import React from 'react';
import {renderToStaticMarkup} from 'react-dom/server';
import {readFileSync} from 'node:fs';
import {checkedMhelpTicketPreview} from '../src/mhelpTicketPreviewModel.ts';
import {checkedMhelpAppointmentEvidence,ticketAppointmentEvidenceFields} from '../src/mhelpAppointmentPreviewModel.ts';
import {checkedMhelpAppointmentVariantEvidence,ticketAppointmentVariantCapability,ticketAppointmentVariantFields,ticketAppointmentCounterKeys,ticketAppointmentCollectionKeys,ticketAppointmentEnvelopeKeys,ticketAppointmentUserFields,ticketAppointmentUserReferenceFormats,ticketAppointmentTicketIdFields,ticketAppointmentPortalIdFields,ticketAppointmentCandidatePairFields} from '../src/mhelpAppointmentVariantPreviewModel.ts';
import MhelpTicketPreview,{MhelpAppointmentEvidence} from '../src/MhelpTicketPreview.tsx';
import {MHELP_APPOINTMENT_VARIANTS,MHELP_APPOINTMENT_VARIANT_FIELDS,MHELP_APPOINTMENT_COUNTER_KEYS,MHELP_APPOINTMENT_COLLECTION_KEYS,MHELP_APPOINTMENT_ENVELOPE_KEYS,MHELP_APPOINTMENT_USER_FIELDS,MHELP_APPOINTMENT_USER_FORMATS,MHELP_APPOINTMENT_TICKET_KEYS,MHELP_APPOINTMENT_PORTAL_KEYS,MHELP_APPOINTMENT_PAIRS,projectMhelpAppointmentVariants,describeMhelpAppointmentVariants} from '../../supabase/functions/cos-operations-pages/mhelpAppointmentVariants.ts';
import {ticketPreviewFixture,ticketPreviewEvidenceFixture,ticketPreviewDetailFixture} from './fixtures/mhelpTicketPreview.mjs';
import {ticketPreviewAppointmentFixture} from './fixtures/mhelpAppointmentTicketPreview.mjs';
import {syntheticAppointment} from './fixtures/mhelpAppointmentPreview.mjs';
import {ticketPreviewAppointmentVariantFixture,syntheticVariantAppointment} from './fixtures/mhelpAppointmentVariantPreview.mjs';
const reject=value=>assert.throws(()=>checkedMhelpTicketPreview(value),error=>error.message==='The ticket preview response could not be verified. Try again.');
const html=evidence=>renderToStaticMarkup(React.createElement(MhelpAppointmentEvidence,{evidence}));
const privatePattern=/synthetic-private|781234|991234|224643|aaaaaaaa-bbbb|2026-10-11T12:00|123456/;

test('variant capability and exact client allowlists match the separate server contract while all old DTOs remain valid',()=>{
  assert.equal(ticketAppointmentVariantCapability,'appointment_variants_v1');assert.equal(ticketAppointmentVariantCapability,MHELP_APPOINTMENT_VARIANTS);
  for(const [client,server] of [[ticketAppointmentVariantFields,MHELP_APPOINTMENT_VARIANT_FIELDS],[ticketAppointmentCounterKeys,MHELP_APPOINTMENT_COUNTER_KEYS],[ticketAppointmentCollectionKeys,MHELP_APPOINTMENT_COLLECTION_KEYS],[ticketAppointmentEnvelopeKeys,MHELP_APPOINTMENT_ENVELOPE_KEYS],[ticketAppointmentUserFields,MHELP_APPOINTMENT_USER_FIELDS],[ticketAppointmentUserReferenceFormats,MHELP_APPOINTMENT_USER_FORMATS],[ticketAppointmentTicketIdFields,MHELP_APPOINTMENT_TICKET_KEYS],[ticketAppointmentPortalIdFields,MHELP_APPOINTMENT_PORTAL_KEYS],[ticketAppointmentCandidatePairFields.map(pair=>[pair.ticket,pair.portal]),MHELP_APPOINTMENT_PAIRS]])assert.deepEqual(client,server);
  assert.equal(ticketAppointmentVariantFields.length,36);assert.equal(new Set([...ticketAppointmentEvidenceFields,...ticketAppointmentVariantFields]).size,53);
  for(const value of [ticketPreviewFixture(),ticketPreviewEvidenceFixture(),ticketPreviewDetailFixture(),ticketPreviewAppointmentFixture(),ticketPreviewAppointmentVariantFixture()])assert.deepEqual(checkedMhelpTicketPreview(value),value);
  const legacy=ticketPreviewAppointmentFixture().appointmentEvidence;
  assert.equal(checkedMhelpAppointmentEvidence(legacy,1,legacy.window.startDateUtc).linkage,'single_structural_match');
  assert.throws(()=>checkedMhelpAppointmentEvidence(ticketPreviewAppointmentVariantFixture().appointmentEvidence,1,legacy.window.startDateUtc),/could not be verified/);
  for(const filename of ['mhelpAppointmentVariantPreviewModel.ts','MhelpTicketPreview.tsx']){
    const source=readFileSync(new URL('../src/'+filename,import.meta.url),'utf8');assert.doesNotMatch(source,/from ['"][^'"]*(?:supabase|mhelpTickets|mhelpToken)/);assert.doesNotMatch(source,/Authorization|accessToken|localStorage|sessionStorage|setInterval|setTimeout/);
  }
});
test('same two explicit buttons request only the new capability and disclose unresolved field variants',()=>{
  const source=readFileSync(new URL('../src/MhelpTicketPreview.tsx',import.meta.url),'utf8');assert.match(source,/ticketAppointmentVariantCapability as ticketAppointmentEvidenceCapability/);
  const rendered=renderToStaticMarkup(React.createElement(MhelpTicketPreview));assert.equal((rendered.match(/<button\b/g)||[]).length,2);assert.doesNotMatch(rendered,/<input|<select|<textarea/);
  for(const text of ['fixed appointment field-name variants and envelope shapes','similar spellings do not verify mappings','No detail is read automatically','No appointments are read for empty or multiple-ticket windows'])assert(rendered.includes(text));
  assert(rendered.indexOf('fixed appointment field-name variants')<rendered.indexOf('<button'));
});
test('v2 roundtrips unavailable, empty, lower-camel, uppercase, mixed and non-object observations without values',()=>{
  for(const count of [0,1,2,500]){const value=ticketPreviewAppointmentVariantFixture({count});assert.deepEqual(checkedMhelpTicketPreview(value),value);assert.deepEqual(projectMhelpAppointmentVariants(value.appointmentEvidence,count,value.window.createdAfter),value.appointmentEvidence);}
  const sources=[null,[],[syntheticVariantAppointment()],false,'synthetic-private',42,{}, {TotalRows:0,results:[]},{TotalRows:1,results:[{}]},{TotalRows:1,results:[syntheticAppointment()]},{TotalRows:1,results:[syntheticVariantAppointment()]},{TotalRows:3,results:[syntheticVariantAppointment(),syntheticAppointment(),{}]},{TotalRows:5,results:[null,[],false,'synthetic-private',42]},{totalRows:1,Results:[syntheticVariantAppointment()],data:[],Data:[{}]}];
  for(const source of sources){
    const value=ticketPreviewAppointmentVariantFixture({source}),evidence=checkedMhelpTicketPreview(value).appointmentEvidence;
    assert.deepEqual(evidence,value.appointmentEvidence);assert.equal(evidence.completeness,'unverified');assert.equal(evidence.linkage,'unverified');assert.equal(evidence.diagnostics.contractState,'unresolved');
    assert.doesNotMatch(JSON.stringify(evidence),privatePattern);assert(Buffer.byteLength(JSON.stringify(evidence))<=16000);assert.doesNotMatch(html(evidence),privatePattern);
  }
  const upper=checkedMhelpTicketPreview(ticketPreviewAppointmentVariantFixture({source:{TotalRows:1,results:[syntheticAppointment()]}})).appointmentEvidence;
  assert.equal(upper.exactMatchCount,1);assert.equal(upper.linkage,'unverified');assert.doesNotMatch(html(upper),/One structural match was found|No match was found/);
  const lower=ticketPreviewAppointmentVariantFixture().appointmentEvidence;assert.equal(lower.exactMatchCount,0);assert.equal(lower.unverifiedLinkageCount,1);assert.match(html(lower),/Documented TicketId\/PortalId spellings only: 0 exact structural ticket-and-portal matches/);assert.doesNotMatch(html(ticketPreviewAppointmentFixture().appointmentEvidence),/Documented TicketId\/PortalId spellings only/);
  for(const count of [0,2])assert.match(html(ticketPreviewAppointmentVariantFixture({count}).appointmentEvidence),/No appointments were read/);
});
test('suppression and empty-object counts are explicit and fixed user-reference formats reveal no identity values',()=>{
  const row=syntheticVariantAppointment({UserId:'999',UserID:'aaaaaaaa-bbbb-cccc-dddd-eeeeeeeeeeee',userId:'synthetic-private@example.test',userID:'synthetic-private-user'});
  const value=ticketPreviewAppointmentVariantFixture({source:{TotalRows:2,results:[row,{}],privateUnknown:{nested:'synthetic-private'}}}),evidence=checkedMhelpTicketPreview(value).appointmentEvidence,d=evidence.diagnostics;
  assert.equal(d.emptyObjectRows,1);assert.equal(d.suppressedEnvelopeKeys,1);assert.equal(d.suppressedRowKeys,1);assert.deepEqual(d.rowKinds,{object:2});
  assert.deepEqual(d.userReferenceFormats,{UserId:{numeric:1},UserID:{uuid_like:1},userId:{email_like:1},userID:{other:1}});
  const rendered=html(evidence);
  for(const text of ['Root kind: object','Empty object rows: 1','Suppressed envelope keys: 1','Suppressed row-key occurrences: 1','Unknown names and all source values are withheld','Numeric string: 1','UUID-like string: 1','Email-like string: 1','No source reference, email address, or verified identity mapping is shown'])assert(rendered.includes(text),text);
  assert.doesNotMatch(rendered,/privateUnknown|synthetic-private|aaaaaaaa-bbbb|999/);
});
test('fixed envelope descriptors report only supported counts and never inspect alternate collections',()=>{
  const source={TotalRows:-1,totalRows:7,TotalResults:8,totalResults:'synthetic-private',results:[{}],Results:[syntheticVariantAppointment()],data:[{},{}],Data:null};
  const evidence=checkedMhelpTicketPreview(ticketPreviewAppointmentVariantFixture({source})).appointmentEvidence,d=evidence.diagnostics;
  assert.deepEqual(d.envelope.TotalRows,{kind:'integer',integerCount:null,arrayEntries:null});assert.equal(d.envelope.totalRows.integerCount,7);assert.equal(d.envelope.TotalResults.integerCount,8);assert.equal(d.envelope.Results.arrayEntries,1);assert.equal(d.envelope.data.arrayEntries,2);
  assert.equal(evidence.sampledAppointments,1);assert.equal(d.fields.ticketId.kinds.absent,1);assert.equal(evidence.reportedTotal,null);
  const rendered=html(evidence);for(const key of ticketAppointmentEnvelopeKeys)assert(rendered.includes('<td>'+key+'</td>'));
  assert.match(rendered,/Alternate envelope collections are counted only/);assert.doesNotMatch(rendered,privatePattern);
  for(const size of [0,1,499,500]){
    const value=ticketPreviewAppointmentVariantFixture({source:{TotalRows:size,results:Array.from({length:size},()=>({}))}});assert.equal(checkedMhelpTicketPreview(value).appointmentEvidence.diagnostics.emptyObjectRows,size);
  }
});
test('full fixed variant table includes absent fields without treating spelling variants as aliases',()=>{
  const evidence=checkedMhelpTicketPreview(ticketPreviewAppointmentVariantFixture()).appointmentEvidence,rendered=html(evidence);
  for(const key of [...ticketAppointmentEvidenceFields,...ticketAppointmentVariantFields])assert(rendered.includes('<td>'+key+'</td>'),key);
  assert.match(rendered,/field-name and envelope contract remains unresolved/);assert.match(rendered,/similar names are not verified aliases/);assert.match(rendered,/do not establish appointment existence, absence, schedule, technician identity, or a source-to-COS mapping/);
  assert.match(rendered,/No staff lookup was performed/);assert.doesNotMatch(rendered,/One structural match was found|No match was found|unscheduled|synthetic-private/);
  assert.equal((rendered.match(/<table\b/g)||[]).length,5);
});
test('v2 rejects added or removed keys at every object layer and never exposes hostile key or value text',()=>{
  const original=ticketPreviewAppointmentVariantFixture(),paths=[];
  const walk=(value,path=[])=>{if(value&&typeof value==='object'&&!Array.isArray(value)){paths.push(path);for(const [key,child] of Object.entries(value))walk(child,[...path,key]);}};walk(original.appointmentEvidence);
  for(const path of paths){const value=structuredClone(original);path.reduce((row,key)=>row[key],value.appointmentEvidence)['synthetic-private@example.test']='synthetic-private';reject(value);}
  for(const path of [[],['diagnostics'],['diagnostics','fields'],['diagnostics','fields','ticketId'],['diagnostics','envelope'],['diagnostics','envelope','TotalRows'],['diagnostics','userReferenceFormats'],['diagnostics','candidatePairs']]){
    for(const key of Object.keys(path.reduce((row,key)=>row[key],original.appointmentEvidence))){const value=structuredClone(original);delete path.reduce((row,key)=>row[key],value.appointmentEvidence)[key];reject(value);}
  }
  for(const remove of ['detailEvidence','operationalEvidence']){const value=structuredClone(original);delete value[remove];reject(value);}
  for(const count of [0,2])for(const mutate of [e=>{e.diagnostics={};},e=>{e.reason=count?'empty_window':'ambiguous_window';},e=>{e.contract='cos-mhelpdesk-appointment-evidence-v1';e.diagnostics={};}]){const value=ticketPreviewAppointmentVariantFixture({count});mutate(value.appointmentEvidence);reject(value);}
});
test('v2 rejects forged mappings, inconsistent descriptor counts and invalid user-reference distributions',()=>{
  const mutations=[
    e=>{e.contract='other';},e=>{e.completeness='complete';},e=>{e.linkage='single_structural_match';},e=>{e.diagnostics.contractState='verified';},
    e=>{e.diagnostics.candidatePairs.comparable.push(0);},e=>{e.diagnostics.candidatePairs.matching=[];},e=>{e.diagnostics.candidatePairs.comparable[10]=2;},e=>{e.diagnostics.candidatePairs.matching[10]=2;},e=>{e.diagnostics.candidatePairs.matching[0]=1;},e=>{e.diagnostics.candidatePairs.ticketAliasConflicts=1;},e=>{e.diagnostics.candidatePairs.portalAliasConflicts=-1;},
    e=>{e.diagnostics.rowKinds={object:2};},e=>{e.diagnostics.rowKinds={object:1,null:0};},e=>{e.diagnostics.emptyObjectRows=1;},e=>{e.diagnostics.emptyObjectRows=-1;},e=>{e.diagnostics.emptyObjectRows='0';},
    e=>{e.diagnostics.fields.ticketId.kinds={string:1};},e=>{e.diagnostics.fields.ticketId.formats={other:1};},e=>{e.diagnostics.fields.userId.nonemptyStrings=0;},e=>{e.diagnostics.fields.userId.emptyStrings=1;},
    e=>{e.diagnostics.envelope.results.arrayEntries=2;},e=>{e.diagnostics.envelope.results.integerCount=1;},e=>{e.diagnostics.envelope.TotalRows.integerCount=2;},e=>{e.diagnostics.envelope.TotalRows.kind='string';},
    e=>{e.diagnostics.envelope.totalRows={kind:'integer',integerCount:1,arrayEntries:null};},e=>{e.diagnostics.envelope.Results={kind:'array',integerCount:null,arrayEntries:null};},e=>{e.diagnostics.envelope.Results={kind:'array',integerCount:null,arrayEntries:501};},e=>{e.diagnostics.envelope.TotalResults.integerCount=1000001;},
    e=>{e.diagnostics.rootArrayEntries=0;},e=>{e.diagnostics.suppressedEnvelopeKeys=-1;},e=>{e.diagnostics.suppressedRowKeys=1000001;},e=>{e.diagnostics.suppressedRowKeys=1.5;},
    e=>{e.diagnostics.userReferenceFormats.userId={email_like:2};},e=>{e.diagnostics.userReferenceFormats.userId={email_like:1,other:0};},e=>{e.diagnostics.userReferenceFormats.userID={numeric:'1'};},e=>{e.diagnostics.userReferenceFormats.UserId={uuid_like:1};},
    e=>{e.diagnostics.userReferenceFormats.userID={source_value:1};},e=>{e.diagnostics.fields.id.raw='synthetic-private'.repeat(16000);},e=>{e.window.endDateUtc='2026-10-15T05:00:00.000Z';},
  ];
  for(const mutation of mutations){const value=ticketPreviewAppointmentVariantFixture();mutation(value.appointmentEvidence);reject(value);}
  for(const source of [null,[]])for(const mutation of [d=>{d.suppressedEnvelopeKeys=1;},d=>{d.suppressedRowKeys=1;},d=>{d.envelope.TotalResults={kind:'integer',integerCount:1,arrayEntries:null};}]){const value=ticketPreviewAppointmentVariantFixture({source});mutation(value.appointmentEvidence.diagnostics);reject(value);}
  const empty=ticketPreviewAppointmentVariantFixture({source:{TotalRows:1,results:[{}]}});empty.appointmentEvidence.diagnostics.fields.ticketId={kinds:{integer:1},formats:{},emptyStrings:0,nonemptyStrings:0};reject(empty);
});

test('fixed candidate comparisons keep strict integer equality and conflicts separate from verified mappings',()=>{
  const rows=[syntheticAppointment(),syntheticVariantAppointment(),syntheticVariantAppointment({ticketId:'781234'}),syntheticVariantAppointment({portalId:998877}),syntheticVariantAppointment({TicketId:42,ticketId:781234,PortalId:'224643'})];
  const evidence=checkedMhelpTicketPreview(ticketPreviewAppointmentVariantFixture({source:{TotalRows:5,results:rows}})).appointmentEvidence,pairs=evidence.diagnostics.candidatePairs;
  assert.equal(pairs.comparable.length,16);assert.equal(pairs.matching.length,16);assert.equal(pairs.matching[0],1);assert.equal(pairs.comparable[10],3);assert.equal(pairs.matching[10],2);assert.equal(pairs.ticketAliasConflicts,1);assert.equal(pairs.portalAliasConflicts,1);
  assert.equal(evidence.exactMatchCount,1);assert.equal(evidence.linkage,'unverified');
  const rendered=html(evidence);assert.match(rendered,/unverified candidate comparisons using positive integers only/);assert.match(rendered,/with no conversion from strings/);assert.match(rendered,/Equality does not verify field meaning, appointment linkage, schedule, or identity/);assert.match(rendered,/Variant spellings are not used for matching in the documented-field summary/);assert.doesNotMatch(rendered,/781234|998877|synthetic-private/);
  for(const change of [pairs=>{delete pairs.comparable[2];},pairs=>{pairs.comparable.private='synthetic-private';},pairs=>{pairs.matching[1]='0';}]){const value=ticketPreviewAppointmentVariantFixture();change(value.appointmentEvidence.diagnostics.candidatePairs);reject(value);}
  const empty=ticketPreviewAppointmentVariantFixture({source:{TotalRows:1,results:[{}]}});empty.appointmentEvidence.diagnostics.suppressedRowKeys=1;reject(empty);
});
test('v2 preserves Chicago DST windows and refuses unavailable evidence for a singleton',()=>{
  for(const createdAfter of ['2026-03-07T06:00:00.000Z','2026-10-31T05:00:00.000Z','2026-12-29T06:00:00.000Z']){
    const evidence=describeMhelpAppointmentVariants({TotalRows:0,results:[]},{ticketId:'781234',portalId:'224643',deleted:false},createdAfter);assert.deepEqual(checkedMhelpAppointmentVariantEvidence(evidence,1,createdAfter),evidence);
  }
  for(const [count,evidenceCount] of [[0,1],[1,0],[1,2],[2,1],[0,2],[2,0]]){const value=ticketPreviewAppointmentVariantFixture({count});value.appointmentEvidence=ticketPreviewAppointmentVariantFixture({count:evidenceCount}).appointmentEvidence;reject(value);}
});
test('new variant browser cases remain in the same early required hosted CI gate',()=>{
  const yaml=readFileSync(new URL('../../../.github/workflows/cos-operations.yml',import.meta.url),'utf8');assert.match(yaml,/Verify mHelp Owner, IT and Service interactions before the full browser suite[\s\S]*npm run test:browser -- tests\/mhelp-intake-review.browser.spec.mjs tests\/mhelp-ticket-preview.browser.spec.mjs tests\/it-ticket-instructions.browser.spec.mjs tests\/service-ticket-instructions.browser.spec.mjs tests\/legacy-install-evidence.browser.spec.mjs/);assert.doesNotMatch(yaml,/continue-on-error: true/);
  const spec=readFileSync(new URL('./mhelp-ticket-preview.browser.spec.mjs',import.meta.url),'utf8');assert.match(spec,/appointment variants.*fixed descriptors/);assert.match(spec,/appointment_variants_v1/);assert.doesNotMatch(spec,/evidence:'appointment_structure_v1'/);
});
