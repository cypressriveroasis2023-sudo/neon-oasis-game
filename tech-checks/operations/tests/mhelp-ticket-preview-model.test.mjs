import test from 'node:test';
import assert from 'node:assert/strict';
import React from 'react';
import {renderToStaticMarkup} from 'react-dom/server';
import {readFileSync} from 'node:fs';
import {checkedMhelpTicketPreview,ticketPreviewGaps} from '../src/mhelpTicketPreviewModel.ts';
import MhelpTicketPreview from '../src/MhelpTicketPreview.tsx';
import {projectMhelpTicketPreview} from '../../supabase/functions/cos-operations-pages/mhelpTickets.ts';
import {ticketPreviewFixture} from './fixtures/mhelpTicketPreview.mjs';

test('client validates the server-projected aggregate without importing backend code into the client',()=>{
  const result=projectMhelpTicketPreview(ticketPreviewFixture());assert.deepEqual(checkedMhelpTicketPreview(result),result);
  for(const filename of ['mhelpTicketPreviewModel.ts','MhelpTicketPreview.tsx']){
    const source=readFileSync(new URL('../src/'+filename,import.meta.url),'utf8');
    assert(!/from ['"][^'"]*(?:supabase|mhelpTickets|mhelpToken)/.test(source));
    assert(!/Authorization|accessToken|localStorage|sessionStorage|setInterval|setTimeout/.test(source));
  }
});
test('ticket preview is an explicit read button with automatic intake paused',()=>{
  const html=renderToStaticMarkup(React.createElement(MhelpTicketPreview));
  assert.match(html,/Preview today’s ticket types/);assert.match(html,/Automatic intake is paused/);assert.match(html,/does not change tickets or assignments/);
  assert(!html.includes('Verified mHelpDesk type IDs and counts'));assert(!html.includes('<input'));assert(!html.includes('<select'));
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
