import test from 'node:test';
import assert from 'node:assert/strict';
import {ticketfreeClient} from '../../ticketfree-returns/client.js';
import {INTAKE_CHECKS,assertIntake,stateLabel,validateContext} from '../../ticketfree-returns/model.js';
const actor='11111111-1111-4111-8111-111111111111';
function fixture(){const state={actor,role:'service',calls:[],lost:false};const context={getSession:()=>({user:{id:state.actor}}),getRole:()=>state.role,getProfile:()=>({user_id:state.actor,active:true}),db:{rpc:async(name,args)=>{state.calls.push({name,args});if(name==='techcheck_ticketfree_context_v1')return {data:{version:1,actor_id:state.actor,role:state.role,returns:[],truck:[],equipment:[],pending_count:0}};if(state.lost){state.lost=false;throw new Error('Connection response lost');}return {data:{request_id:args.p_request_id,return_id:args.p_request_id,state:'waiting_it',revision:1}};},storage:{from:()=>({upload:async()=>({})})}}};return {state,client:ticketfreeClient(context)};}
test('context is bound to the actual account, not a cached persona',async()=>{const {state,client}=fixture();assert.equal((await client.read()).actor_id,actor);state.actor='other';await assert.rejects(client.read(),/account changed/);assert.throws(()=>validateContext({version:1,actor_id:'other'},actor,'service'),/verified/);});
test('retry sends the same immutable request rather than manufacturing a second return',async()=>{const {state,client}=fixture();const args={p_request_id:crypto.randomUUID(),p_returned_key:'sniper:017',p_photos:[]};state.lost=true;await assert.rejects(client.submit('submit',args,[]),/lost/);await client.submit('submit',args,[]);assert.deepEqual(state.calls[0].args,state.calls[1].args);});
test('invalid or ambiguous save receipts do not become success',async()=>{const {client}=fixture();await assert.rejects(client.submit('receive',{p_request_id:crypto.randomUUID(),p_return_id:crypto.randomUUID(),p_photos:[]},[]),/not verified/);});
test('Ready requires physical receipt and six explicit passing answers',()=>{const ready={received:true,disposition:'ready',checks:Object.fromEntries(INTAKE_CHECKS.map(([k])=>[k,true])),notes:''};assert.doesNotThrow(()=>assertIntake(ready));assert.throws(()=>assertIntake({...ready,received:false}),/physically/);assert.throws(()=>assertIntake({...ready,checks:{}}),/six/);assert.throws(()=>assertIntake({...ready,checks:{...ready.checks,batteries_ok:false}}),/repair/);assert.throws(()=>assertIntake({...ready,disposition:'repair'}),/Describe/);assert.equal(stateLabel('waiting_it'),'Waiting for IT');});

import {batchDraft,cataloguePage,selectItem,prepareBatch,itemReason,savedReturnReason,reasonLabel} from '../../ticketfree-returns/batch-model.js';
test('catalogue searches every family beyond the original 100-row cutoff and pages the entire collection',()=>{
 const catalogue=[...Array.from({length:140},(_,n)=>({family:'Recon',name:'Recon '+n,equipment_key:'recon:'+n})),{family:'Sniper',name:'Sniper 176',equipment_key:'sniper:176'},{family:'Spotter',name:'Spotter 257HDC2',equipment_key:'spotter:257HDC2'}];
 assert.equal(cataloguePage(catalogue,'Sniper 176').items[0].equipment_key,'sniper:176');
 assert.equal(cataloguePage(catalogue,'257hdc2').count,1);assert.equal(cataloguePage(catalogue,'','Spotter').count,1);
 const seen=[];for(let n=0;n<6;n++)seen.push(...cataloguePage(catalogue,'','',n).items);assert.equal(seen.length,142);
});
test('an interrupted legacy single return keeps its original request and photo identities after upgrade',()=>{
 const request={p_request_id:'same-id',p_returned_key:'sniper:176',p_used_key:null,p_notes:'original',p_photos:['original-photo']};
 const next=batchDraft({request,photos:[],notes:'original'},[]);assert.equal(next.items[0].id,'same-id');assert.equal(next.request.p_items[0].request_id,'same-id');assert.deepEqual(next.request.p_items[0].photos,['original-photo']);
});
test('multi-select preserves all truck entries, including unmatched identities, and prevents return/install overlap',async()=>{
 const draft=batchDraft({photos:[],notes:''});for(const family of ['Sniper','Spotter','Ranger','Solar Spotter'])selectItem(draft,{family,unit_tag:'001'},'truck');assert.equal(draft.items.length,4);
 const client={assert(){},paths:async()=>[]};const args=await prepareBatch(draft,client);assert.equal(args.p_items.length,4);assert.ok(args.p_items.every(i=>i.returned_key===null));
 draft.items[0].equipment_key='sniper:001';draft.items[1].usedKey='sniper:001';await assert.rejects(prepareBatch(draft,client),/same time/);
});
test('unmatched intake is receipt only, never a route into available inventory',()=>{
 const args={needsReview:true,received:true,disposition:'review',checks:Object.fromEntries(INTAKE_CHECKS.map(([k])=>[k,true]))};assert.doesNotThrow(()=>assertIntake(args));assert.throws(()=>assertIntake({...args,disposition:'ready'}),/cannot be marked Ready/);
});


test('explicit swap needs the used truck unit; pickup and unused return consume no replacement',async()=>{
 const draft=batchDraft({notes:'',photos:[]}),client={assert(){},paths:async()=>[]};
 selectItem(draft,{equipment_key:'sniper:176',family:'Sniper',unit_tag:'176'},'swap');
 await assert.rejects(prepareBatch(draft,client),/equipment used from your truck/);
 draft.items[0].usedKey='ranger:002';assert.equal((await prepareBatch(draft,client)).p_items[0].used_key,'ranger:002');
 draft.items[0].reason='pickup';await assert.rejects(prepareBatch(draft,client),/Only a swap/);
 draft.items[0].usedKey='';assert.equal((await prepareBatch(draft,client)).p_items[0].used_key,null);
});
test('starting from used truck stock pairs it once and keeps a second return unpaired',()=>{
 const draft=batchDraft({notes:'',photos:[]});draft.pendingUsedKey='ranger:002';
 selectItem(draft,{equipment_key:'sniper:176'},'swap');selectItem(draft,{equipment_key:'spotter:257HDC2'},'pickup');
 assert.equal(draft.items[0].usedKey,'ranger:002');assert.equal(itemReason(draft.items[0]),'swap');
 assert.equal(draft.items[1].usedKey,'');assert.equal(itemReason(draft.items[1]),'pickup');assert.equal(draft.pendingUsedKey,'');
});
test('legacy drafts retain their immutable payloads and receive accurate reason labels',()=>{
 const request={p_items:[{request_id:'same-id',returned_key:'sniper:176',used_key:'ranger:002'}]};
 const next=batchDraft({tab:'site',items:[{id:'same-id',source:'site',usedKey:'ranger:002'}],request});
 assert.equal(next.tab,'pickup');assert.equal(next.items[0].reason,'swap');assert.equal(next.request,request);
 for(const [mode,reason]of [['swap','swap'],['field_return','pickup'],['truck_return','truck_return']])assert.equal(savedReturnReason({source_mode:mode}),reason);
 assert.equal(reasonLabel(savedReturnReason({source_mode:'field_return'})),'Pickup from site');
 assert.equal(reasonLabel(savedReturnReason({})),'Return reason unavailable');
});
