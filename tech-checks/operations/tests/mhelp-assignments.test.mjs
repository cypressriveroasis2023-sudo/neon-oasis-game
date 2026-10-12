import test from 'node:test';
import assert from 'node:assert/strict';
import {createAssignmentHandler,projectCustomer} from '../../supabase/functions/cos-mhelp-assignments/index.ts';
const req=body=>new Request('https://example.test',{method:'POST',headers:{'content-type':'application/json'},body:JSON.stringify(body)});
test('customer rule uses exact name and excludes address, notes and secrets',()=>{
 const row={customerId:1,portalId:224643,name:'Cameras Onsite',isServiceLocation:false,address1:'private',notes:'secret'};
 assert.deepEqual(projectCustomer(row,'1','224643'),{customerId:'1',name:'Cameras Onsite',isServiceLocation:false,placement:'SHOP'});
 assert.equal(projectCustomer({...row,name:'Cameras Onsite Customer'},'1','224643').placement,'FIELD');
 assert.equal(projectCustomer({...row,name:'Cameras Onsite LLC'},'1','224643').placement,'SHOP');
 assert.throws(()=>projectCustomer({...row,portalId:2},'1','224643'));
});
test('authentication precedes parsing or vendor calls',async()=>{let calls=0;const h=createAssignmentHandler({authenticate:async()=>false,equipment:async()=>{calls++},customers:async()=>{calls++}});assert.equal((await h(req({action:'equipment'}))).status,403);assert.equal(calls,0);});
test('caller cannot inject credentials, URLs, or oversized IDs',async()=>{let calls=0;const h=createAssignmentHandler({authenticate:async()=>true,equipment:async()=>{calls++},customers:async()=>{calls++}});for(const body of [{action:'equipment',token:'secret'},{action:'customers',ids:['1/other']},{action:'customers',ids:['1','1']},{action:'customers',ids:Array.from({length:41},(_,i)=>String(i+1))}])assert.equal((await h(req(body))).status,400);assert.equal(calls,0);});
test('equipment projector returns allowlisted fields only and requires complete read',async()=>{const item={equipmentId:'1',name:'Solar Pole 72 002',model:null,customerId:'2',serviceLocationId:'3',active:true,updatedAt:null,notes:'secret',accessToken:'secret'};const h=createAssignmentHandler({authenticate:async()=>true,equipment:async()=>({liveAccessVerified:true,partial:false,totalRows:1,verifiedPortalId:'224643',items:[item]}),customers:async()=>[]});const r=await(await h(req({action:'equipment'}))).json();assert.equal(r.items[0].notes,undefined);assert.equal(r.items[0].accessToken,undefined);assert.equal(r.items[0].equipmentId,'1');});
test('vendor error bodies are not returned',async()=>{const h=createAssignmentHandler({authenticate:async()=>true,equipment:async()=>{throw Error('private token')},customers:async()=>[]});const r=await h(req({action:'equipment'}));assert.equal(r.status,503);assert.equal((await r.text()).includes('private token'),false);});
