import test from 'node:test';
import assert from 'node:assert/strict';
import {checkedMhelpTicketPreview} from '../src/mhelpTicketPreviewModel.ts';
import {projectMhelpTicketPreview} from '../../supabase/functions/cos-operations-pages/mhelpTickets.ts';
import {describeMhelpOperationalEvidence} from '../../supabase/functions/cos-operations-pages/mhelpTicketSchema.ts';
import {describeMhelpTicketDetail,unavailableMhelpTicketDetail,MHELP_TICKET_DETAIL_EVIDENCE} from '../../supabase/functions/cos-operations-pages/mhelpTicketDetail.ts';
import {ticketPreviewFixture} from './fixtures/mhelpTicketPreview.mjs';

test('server detail and list evidence round-trip through strict client contract without source values',()=>{
 const privateText='synthetic-private-cross-contract',source={subject:privateText,summary:privateText,comment:null,serviceLocationId:987654,
  items:[{ticketItemId:987655,name:privateText,description:privateText,quantity:1,amount:987656,contact:privateText},null],
  customFields:[{customFieldId:987657,fieldLabel:privateText,fieldValue:privateText}],equipment:[987658],billing:privateText,attachments:[privateText]};
 const fixture=ticketPreviewFixture(),base={...fixture,totalRows:1,previewCount:1,
  types:fixture.types.map(row=>({...row,count:Math.min(row.count,1)})),statuses:fixture.statuses.map(row=>({...row,statusCount:Math.min(row.statusCount,1),customStatusCount:Math.min(row.customStatusCount,1)})),
  metrics:Object.fromEntries(Object.keys(fixture.metrics).map(key=>[key,0]))};
 // Avoid ambiguous aggregate sums: this test isolates the structural contract.
 for(const row of base.types)row.count=0;
 for(const row of base.statuses){row.statusCount=0;row.customStatusCount=0;}
 for(const count of [0,1,2]){
  const value={...base,totalRows:count,previewCount:count,
   types:base.types.map((row,index)=>({...row,count:index===0?count:0})),
   statuses:base.statuses.map((row,index)=>({...row,statusCount:index===0?count:0})),
   operationalEvidence:describeMhelpOperationalEvidence(Array.from({length:count},()=>source),count),
   detailEvidence:count===1?describeMhelpTicketDetail(source):unavailableMhelpTicketDetail(count)};
  const projected=projectMhelpTicketPreview(value,MHELP_TICKET_DETAIL_EVIDENCE),checked=checkedMhelpTicketPreview(projected);
  assert.deepEqual(checked,projected);
  const serialized=JSON.stringify(checked);
  for(const value of [privateText,'987654','987655','987656','987657','987658','billing','attachments','contact','amount'])assert(!serialized.includes(value),value);
 }
});
