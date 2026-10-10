import test from 'node:test';
import assert from 'node:assert/strict';
import React from 'react';
import {renderToStaticMarkup} from 'react-dom/server';
import {readFileSync} from 'node:fs';
import {checkedMhelpTicketPreview,ticketPreviewGaps} from '../src/mhelpTicketPreviewModel.ts';
import {mhelpPreviewDiagnosticMessages,mhelpTicketPreviewErrorMessage} from '../src/mhelpTicketPreviewError.ts';
import {OperationsApiError} from '../src/api.ts';
import MhelpTicketPreview from '../src/MhelpTicketPreview.tsx';
import {projectMhelpTicketPreview} from '../../supabase/functions/cos-operations-pages/mhelpTickets.ts';
import {describeMhelpOperationalEvidence} from '../../supabase/functions/cos-operations-pages/mhelpTicketSchema.ts';
import {MHELP_PREVIEW_DIAGNOSTIC_CODES} from '../../supabase/functions/cos-operations-pages/mhelpTicketDiagnostics.ts';
import {ticketPreviewFixture,ticketPreviewEvidenceFixture} from './fixtures/mhelpTicketPreview.mjs';

test('client validates the server-projected aggregate without importing backend code into the client',()=>{
  const result=projectMhelpTicketPreview(ticketPreviewFixture());assert.deepEqual(checkedMhelpTicketPreview(result),result);
  for(const filename of ['mhelpTicketPreviewModel.ts','mhelpTicketPreviewError.ts','MhelpTicketPreview.tsx']){
    const source=readFileSync(new URL('../src/'+filename,import.meta.url),'utf8');
    assert(!/from ['"][^'"]*(?:supabase|mhelpTickets|mhelpToken)/.test(source));
    assert(!/Authorization|accessToken|localStorage|sessionStorage|setInterval|setTimeout/.test(source));
  }
});
test('client diagnostic catalog exactly covers the server allowlist with fixed reference messages',()=>{
  assert.deepEqual(Object.keys(mhelpPreviewDiagnosticMessages).sort(),[...MHELP_PREVIEW_DIAGNOSTIC_CODES].sort());
  for(const [code,message] of Object.entries(mhelpPreviewDiagnosticMessages)){
    const reference='MHELP_PREVIEW_'+code;
    for(const status of [400,409,503])assert.equal(mhelpTicketPreviewErrorMessage(new OperationsApiError(reference,status)),message+' Reference: '+reference+'.');
  }
});
test('session and rate-limit responses keep their existing messages without exposing diagnostic text',()=>{
  for(const value of ['MHELP_PREVIEW_INTERNAL_FAILURE','synthetic private provider text']){
    for(const status of [401,403])assert.equal(mhelpTicketPreviewErrorMessage(new OperationsApiError(value,status)),'Your Owner session could not be verified. Return to Tech Check and sign in again.');
    assert.equal(mhelpTicketPreviewErrorMessage(new OperationsApiError(value,429)),'mHelpDesk is limiting ticket reads. Wait a moment, then try again.');
  }
});
test('window diagnostics describe the selected window for both supported days',()=>{
  for(const code of ['COUNT_LIMIT','WINDOW_MISMATCH','WINDOW_INVALID']){
    const message=mhelpTicketPreviewErrorMessage(new OperationsApiError('MHELP_PREVIEW_'+code,503));
    assert.match(message,/selected window/);assert.doesNotMatch(message,/today|previous day/i);
  }
});
test('private, unknown, forged and wrong-status diagnostic errors stay generic',()=>{
  const generic='The ticket preview could not be verified. Try again.',known='MHELP_PREVIEW_TIMESTAMP_TIMEZONE';
  for(const value of ['private@example.test secret','MHELP_PREVIEW_UNKNOWN','MHELP_PREVIEW___proto__','MHELP_PREVIEW_constructor',known+' private',known+'\n',known.toLowerCase(),' '+known,known+'<script>private</script>'])assert.equal(mhelpTicketPreviewErrorMessage(new OperationsApiError(value,503)),generic);
  for(const value of [new Error(known),{response:{status:503,data:{error:known}}},{name:'OperationsApiError',message:known},Object.create(OperationsApiError.prototype),null,known])assert.equal(mhelpTicketPreviewErrorMessage(value),generic);
  for(const status of [200,302,404,500])assert.equal(mhelpTicketPreviewErrorMessage(new OperationsApiError(known,status)),generic);
});
test('diagnostic rendering ignores extra response fields and generic transport save wording',()=>{
  const cause=new OperationsApiError('MHELP_PREVIEW_TIMESTAMP_TIMEZONE',503);
  cause.response.data.detail='synthetic private provider text';cause.response.data.rawBody={private:'secret'};
  assert.equal(mhelpTicketPreviewErrorMessage(cause),mhelpPreviewDiagnosticMessages.TIMESTAMP_TIMEZONE+' Reference: MHELP_PREVIEW_TIMESTAMP_TIMEZONE.');
  assert.equal(mhelpTicketPreviewErrorMessage(new OperationsApiError('The save could not be confirmed. Refresh this workspace before trying again.',503)),'The ticket preview could not be verified. Try again.');
});
test('ticket previews offer only explicit today and previous-day reads without claiming global intake status',()=>{
  const html=renderToStaticMarkup(React.createElement(MhelpTicketPreview));
  assert.match(html,/Preview today’s ticket types/);assert.match(html,/Preview previous day’s ticket types/);assert.match(html,/This is a read-only preview/);assert.match(html,/does not change tickets or assignments/);
  assert.match(html,/prior Central Time calendar day/);assert.match(html,/does not import historical tickets/);assert.equal((html.match(/<button\b/g)||[]).length,2);
  assert(!html.includes('Verified mHelpDesk type IDs and counts'));assert(!html.includes('<input'));assert(!html.includes('<select'));
});
test('client accepts a completed prior-day window without inventing a local date or changing its bounds',()=>{
  const fixture=ticketPreviewFixture();fixture.window={createdAfter:'2026-10-08T05:00:00.000Z',createdBefore:'2026-10-09T05:00:00.000Z'};
  const checked=checkedMhelpTicketPreview(fixture);assert.deepEqual(checked.window,fixture.window);assert.equal(checked.readAt,fixture.readAt);
});
test('preview count headers explicitly describe their columns to assistive technology',()=>{
  const source=readFileSync(new URL('../src/MhelpTicketPreview.tsx',import.meta.url),'utf8');
  assert.match(source,/<th scope='col'>mHelpDesk type<\/th>/);
  assert.match(source,/<th scope='col'>Tickets in window<\/th>/);
});
test('client rejects partial reads, inactive safety flags, invalid portals and inconsistent totals',()=>{
  const v=ticketPreviewFixture();
  for(const change of [{contract:'other'},{state:'ready'},{liveAccessVerified:false},{automaticSync:true},{ticketWrites:true},{partial:true},{verifiedPortalId:'999'},{totalRows:501},{previewCount:2},{totalRows:3.5}])assert.throws(()=>checkedMhelpTicketPreview({...v,...change}));
});
test('client rejects malformed dictionaries, duplicate identities and unexpected private fields at every level',()=>{
  for(const change of [v=>({...v,rawTickets:[{subject:'private'}]}),v=>({...v,types:[...v.types,v.types[0]]}),v=>({...v,statuses:[...v.statuses,v.statuses[0]]}),v=>({...v,types:[{...v.types[0],count:4},v.types[1]]}),v=>({...v,types:[{...v.types[0],typeName:'bad\nlabel'},v.types[1]]}),v=>({...v,statuses:[{...v.statuses[0],parentId:'999'}]}),v=>({...v,statuses:[{...v.statuses[0],parentId:'1'}]}),v=>({...v,window:{...v.window,token:'private'}}),v=>({...v,metrics:{...v.metrics,private:'private'}}),v=>({...v,types:[{...v.types[0],private:'private'},v.types[1]]}),v=>({...v,statuses:[{...v.statuses[0],private:'private'}]})])assert.throws(()=>checkedMhelpTicketPreview(change(ticketPreviewFixture())),error=>!error.message.includes('private'));
});
test('timestamps require real UTC dates, increasing bounded windows and a read after the window',()=>{
  const v=ticketPreviewFixture();
  for(const change of [{readAt:'2026-02-30T20:00:01Z'},{readAt:'2026-10-09T19:00:00Z'},{readAt:'2026-10-09T20:00:01'},{window:{...v.window,createdAfter:'2026-10-09T24:00:00Z'}},{window:{...v.window,createdBefore:v.window.createdAfter}},{window:{...v.window,createdAfter:'2026-01-01T00:00:00Z'}}])assert.throws(()=>checkedMhelpTicketPreview({...v,...change}));
});
test('missing assignments stay unknown and metric sums cannot imply complete coverage incorrectly',()=>{
  const v=ticketPreviewFixture(),checked=checkedMhelpTicketPreview(v);
  assert(ticketPreviewGaps(checked).includes('1 ticket with an unknown assignment field'));
  assert(ticketPreviewGaps(checked).includes('1 ticket missing a service-location ID'));
  for(const metrics of [{...v.metrics,missingAssignmentFields:2},{...v.metrics,missingTypeIds:1},{...v.metrics,unknownStatusIds:1},{...v.metrics,unknownFieldOccurrences:0},{...v.metrics,duplicateTypeNames:1},{...v.metrics,assignedTickets:3.5}])assert.throws(()=>checkedMhelpTicketPreview({...v,metrics}));
});
test('zero-ticket preview retains the verified dictionary without inventing missing work',()=>{
  const v=ticketPreviewFixture();v.totalRows=0;v.previewCount=0;v.types=v.types.map(type=>({...type,count:0}));v.statuses=v.statuses.map(status=>({...status,statusCount:0,customStatusCount:0}));
  v.metrics=Object.fromEntries(Object.keys(v.metrics).map(key=>[key,0]));assert.equal(checkedMhelpTicketPreview(v).previewCount,0);assert.deepEqual(ticketPreviewGaps(v),[]);
});
test('optional operational evidence is validated independently and legacy success stays unchanged',()=>{
  const legacy=ticketPreviewFixture(),current=ticketPreviewEvidenceFixture();
  assert.deepEqual(checkedMhelpTicketPreview(legacy),legacy);
  assert.equal(Object.hasOwn(checkedMhelpTicketPreview(legacy),'operationalEvidence'),false);
  assert.deepEqual(checkedMhelpTicketPreview(current),current);
  assert.equal(checkedMhelpTicketPreview(current).statuses[1].parentId,'1');
  for(const operationalEvidence of [undefined,null,false,[],{},'synthetic private'])assert.throws(()=>checkedMhelpTicketPreview({...legacy,operationalEvidence}),/could not be verified/);
});
test('client accepts real server-generated structural evidence for zero, mixed and capped first pages',()=>{
  for(const ticketCount of [0,3,51]){
    const preview=ticketPreviewEvidenceFixture({ticketCount});
    const rows=Array.from({length:ticketCount},(_,index)=>({subject:index%2?'synthetic private work text':'',summary:null,comment:[],scheduledDate:'2026-10-09T12:30:00Z',neededBy:'/Date(1791547200000)/',serviceLocationId:index+1,
      items:index===0?Array.from({length:60},(_,n)=>({ticketItemId:n+1,priceListId:100+n,priceListTypeId:1,name:'synthetic private item text',description:null,quantity:1.5})):[],
      customFields:index%2?[{customFieldId:1,fieldValue:'synthetic private custom value',fieldLabel:'synthetic private label'},null]:[]
    }));
    preview.operationalEvidence=describeMhelpOperationalEvidence(rows,ticketCount);
    assert.deepEqual(checkedMhelpTicketPreview(preview),preview);
    assert.equal(preview.operationalEvidence.sampledTickets,Math.min(ticketCount,50));
    assert.equal(preview.operationalEvidence.collections.items.sampledEntries,ticketCount?50:0);
    assert.doesNotMatch(JSON.stringify(checkedMhelpTicketPreview(preview)),/synthetic private/);
  }
});
test('first-page evidence and nested samples enforce independent limits, including empty samples',()=>{
  for(const ticketCount of [0,1,49,50,51,500])for(const itemEntries of [0,1,49,50,51,1000000]){
    const value=ticketPreviewEvidenceFixture({ticketCount,itemEntries,customEntries:itemEntries});
    const checked=checkedMhelpTicketPreview(value).operationalEvidence;
    assert.deepEqual(checked,value.operationalEvidence);assert.equal(checked.sampledTickets,Math.min(ticketCount,50));
    assert.equal(checked.collections.items.sampledEntries,ticketCount?Math.min(itemEntries,50):0);
    assert.equal(checked.collections.items.totalEntries,ticketCount?itemEntries:0);
    assert(new TextEncoder().encode(JSON.stringify(checked)).length<=12000);
  }
});
test('all fixed kind and string-format categories roundtrip without exposing values',()=>{
  const value=ticketPreviewEvidenceFixture({ticketCount:9}),field=value.operationalEvidence.fields.subject;
  field.kinds={absent:1,null:1,boolean:1,integer:1,number:1,string:1,array:1,object:1,other:1};
  field.formats={numeric:1};field.emptyStrings=0;field.nonemptyStrings=1;
  assert.deepEqual(checkedMhelpTicketPreview(value),value);
  field.kinds={string:9};field.formats={numeric:1,iso_with_zone:2,iso_without_zone:3,dotnet:1,other:2};field.emptyStrings=2;field.nonemptyStrings=7;
  assert.deepEqual(checkedMhelpTicketPreview(value),value);
});
test('malformed operational evidence fails closed at every level with a generic redacted error',()=>{
  const cases=[
    e=>{e.contract='synthetic private';},e=>{e.scope='full_window';},e=>{e.ticketSampleLimit=51;},e=>{e.nestedSampleLimit=51;},
    e=>{e.sampledTickets=2;},e=>{e.sampledTickets=51;},e=>{e.siteIdTickets=4;},e=>{e.siteIdTickets=-1;},e=>{e.siteIdTickets=1.5;},
    e=>{e.fields.serviceLocationId.kinds={null:3};},
    e=>{e.secret='synthetic private';},e=>{delete e.scope;},e=>{e.fields.secret='synthetic private';},e=>{delete e.fields.comment;},
    e=>{e.fields.subject.raw='synthetic private';},e=>{delete e.fields.subject.formats;},
    e=>{e.fields.subject.kinds={private:3};},e=>{e.fields.subject.kinds={string:3,absent:0};},
    e=>{e.fields.subject.kinds={string:2};},e=>{e.fields.subject.kinds={string:51};},e=>{e.fields.subject.kinds={string:1.5,absent:1.5};},e=>{e.fields.subject.kinds={string:'3'};},
    e=>{e.fields.subject.kinds={string:4,absent:-1};},e=>{e.fields.subject.kinds=[];},
    e=>{e.fields.subject.formats={private:3};},e=>{e.fields.subject.formats={other:2};},e=>{e.fields.subject.formats={other:3,numeric:0};},
    e=>{e.fields.subject.emptyStrings=0;},e=>{e.fields.subject.nonemptyStrings=51;},e=>{e.fields.subject.nonemptyStrings='2';},
    e=>{e.collections.secret='synthetic private';},e=>{delete e.collections.customFields;},
    e=>{e.collections.items.raw='synthetic private';},e=>{delete e.collections.items.entryKinds;},e=>{e.collections.items.kinds={array:2};},
    e=>{e.collections.items.emptyArrays=0;},e=>{e.collections.items.nonemptyArrays=0;},e=>{e.collections.items.totalEntries=0;},
    e=>{e.collections.items.totalEntries=1000001;},e=>{e.collections.items.totalEntries=1.5;},e=>{e.collections.items.totalEntries='2';},
    e=>{e.collections.items.sampledEntries=1;},e=>{e.collections.items.sampledEntries=51;},e=>{e.collections.items.entryKinds={object:1};},e=>{e.collections.items.entryKinds={secret:2};},
    e=>{e.collections.items.fields.equipmentId='synthetic private';},e=>{delete e.collections.items.fields.priceListTypeId;},
    e=>{e.collections.items.fields.name.value='synthetic private';},e=>{e.collections.items.fields.name.nonemptyStrings=1;},
    e=>{e.collections.customFields.fields.fieldValue.formats={other:1,private:'synthetic private'};},
    e=>{e.collections.customFields.fields.fieldLabel.kinds={string:50};},e=>{e.collections.customFields.fields.fieldValue.raw='synthetic private'.repeat(13000);}
  ];
  for(const mutate of cases){
    const value=ticketPreviewEvidenceFixture();mutate(value.operationalEvidence);
    assert.throws(()=>checkedMhelpTicketPreview(value),error=>error.message==='The ticket preview response could not be verified. Try again.');
  }
});
test('collection totals cannot claim entries without nonempty arrays or fewer entries than arrays',()=>{
  for(const mutate of [
    c=>{c.emptyArrays=3;c.nonemptyArrays=0;},
    c=>{c.emptyArrays=0;c.nonemptyArrays=3;},
    c=>{c.totalEntries=51;c.sampledEntries=49;},
  ]){const value=ticketPreviewEvidenceFixture();mutate(value.operationalEvidence.collections.items);assert.throws(()=>checkedMhelpTicketPreview(value));}
  const empty=ticketPreviewEvidenceFixture({ticketCount:0});empty.operationalEvidence.fields.subject.kinds={absent:1};
  assert.throws(()=>checkedMhelpTicketPreview(empty));
});
