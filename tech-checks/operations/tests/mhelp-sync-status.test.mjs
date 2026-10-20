import test from 'node:test';
import assert from 'node:assert/strict';
import {mhelpSyncStatus} from '../src/mhelpSyncStatus.ts';
const now=Date.parse('2026-10-20T17:25:00Z');
const fixture=()=>({uploadInventory:{contract:'COS_MHELP_UPLOAD_INVENTORY_V1',source:'mhelpdesk_api',lastApiReadAt:'2026-10-20T17:21:07Z',summary:{totalRecords:1001,fieldRecords:287,shopRecords:714}},mhelpPlacementSync:{inventoryEnabled:true,errorCode:null,nextReadAt:null}});
test('saved complete API update supplies totals and real time without claiming present authentication',()=>{
 assert.deepEqual(mhelpSyncStatus(fixture(),now),{label:'Up to date',connection:'Access verified at last update',lastSuccess:'2026-10-20T17:21:07Z',retryAt:null,field:287,shop:714});
});
test('file upload is inventory evidence but never an API freshness observation',()=>{
 const f=fixture();f.uploadInventory.source='owner_supplied_mhelp_export';f.uploadInventory.receivedAt='2026-10-20T17:21:07Z';
 assert.equal(mhelpSyncStatus(f,now).lastSuccess,null);assert.equal(mhelpSyncStatus(f,now).label,'Not yet verified');
});
test('old observations age without relabeling or erasing the last success',()=>{
 const s=mhelpSyncStatus(fixture(),now+31*60000);assert.equal(s.label,'Not yet verified');assert.equal(s.lastSuccess,'2026-10-20T17:21:07Z');assert.equal(s.field,287);
});
test('generic failures and cooldown never demand new credentials',()=>{
 for(const error of ['inventory_source_unavailable','source_http_503','source_rate_limited']){
  const f=fixture();f.mhelpPlacementSync.errorCode=error;assert.equal(mhelpSyncStatus(f,now).label,'Not yet verified');
  f.mhelpPlacementSync.nextReadAt='2026-10-20T18:00:00Z';const s=mhelpSyncStatus(f,now);assert.equal(s.label,'Waiting for mHelpDesk');assert.equal(s.retryAt,'2026-10-20T18:00:00Z');assert.equal(s.lastSuccess,'2026-10-20T17:21:07Z');
 }
});
test('malformed totals and future success times cannot be called current',()=>{
 const f=fixture();f.uploadInventory.summary.totalRecords=1000;assert.equal(mhelpSyncStatus(f,now).field,null);
 const future=fixture();future.uploadInventory.lastApiReadAt='2026-10-21T17:21:07Z';assert.equal(mhelpSyncStatus(future,now).lastSuccess,null);
 for(const value of [null,{},[],{uploadInventory:{}}])assert.equal(mhelpSyncStatus(value,now).label,'Not yet verified');
});
test('elapsed or invalid cooldowns do not invent a next attempt',()=>{
 for(const nextReadAt of ['2026-10-19T18:00:00Z','invalid',null]){
  const f=fixture();f.mhelpPlacementSync.nextReadAt=nextReadAt;assert.equal(mhelpSyncStatus(f,now).retryAt,null);
 }
});
