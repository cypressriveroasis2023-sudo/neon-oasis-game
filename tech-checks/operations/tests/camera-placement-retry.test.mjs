// Synthetic dialog/read lifecycle. No browser, vendor request or operational write.
import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import vm from 'node:vm';
import {randomUUID} from 'node:crypto';
import {key,nativeRow,envelope,healthEnvelope,legacyState} from './camera-shop-field-restore-fixtures.mjs';
const source=fs.readFileSync(new URL('../../camera-placement-controls.js',import.meta.url),'utf8');
const turn=()=>new Promise(resolve=>setImmediate(resolve));
async function until(check){for(let i=0;i<30;i++){if(check())return;await turn();}assert.ok(check(),'synthetic lifecycle did not settle');}
function fixture(){
 const f={calls:[],requests:[],saved:[],timeouts:[],holds:[],sessionHolds:[],fetchHolds:[],holdSessionAt:0,holdPath:'',failed:new Set(),holdLegacy:false,denyWrite:false,subject:'synthetic-owner',state:legacyState({placement:'FIELD'}),snapshot:envelope([nativeRow({currentLocationType:'field'})]),health:healthEnvelope(),sessionReads:0,dialogs:[]};
 const input=(name,required=false)=>({name,required,value:'',checked:false,disabled:false,label:{hidden:false},closest(){return this.label;},focus(){f.focus=this;}});
 const fields={site:input('site'),address:input('address'),reason:input('reason',true),confirmed:input('confirmed',true)};
 const nodes={feedback:{textContent:''},note:{textContent:''},title:{textContent:''},unit:{textContent:''},save:{disabled:true},cancel:{disabled:false},retry:{hidden:true,disabled:false}};
 const form={elements:{namedItem:name=>fields[name]},querySelector(selector){return selector==='[type=submit]'?nodes.save:selector==='.placement-cancel'?nodes.cancel:selector==='.placement-retry'?nodes.retry:null;},querySelectorAll:()=>Object.values(fields),reportValidity:()=>Object.values(fields).every(field=>field.disabled||!field.required||(field.name==='confirmed'?field.checked:field.value.trim()))};
 const dialog={isConnected:false,className:'',innerHTML:'',setAttribute(){},querySelector(selector){return selector==='form'?form:selector==='h2'?nodes.title:selector==='.placement-feedback'?nodes.feedback:selector==='.placement-pin-note'?nodes.note:selector==='.placement-unit'?nodes.unit:null;},addEventListener(){},showModal(){},close(){},remove(){this.isConnected=false;}};
 const db={auth:{getSession:async()=>{f.sessionReads++;const reply={data:{session:{access_token:'synthetic-only',user:{id:f.subject}}}};if(f.sessionReads===f.holdSessionAt)await new Promise(resolve=>f.sessionHolds.push(resolve));return reply;}},rpc:async(name,args)=>{
  f.calls.push({name,args});
  if(name==='owner_camera_unit_placement_state_v2'){const state=structuredClone(f.state);if(f.holdLegacy)await new Promise(resolve=>f.holds.push(resolve));return {data:state};}
  assert.equal(name,'owner_set_camera_unit_placement_v2');if(f.denyWrite)return {error:{message:'Synthetic writer denied'}};
  f.state={...f.state,placement:args.p_placement,siteLabel:args.p_site_label,streetAddress:args.p_street_address,auditId:'101'};
  return {data:{ok:true,unit_key:key,placement:args.p_placement,request_id:args.p_request_id,audit_id:'101'}};
 }};
 const context=vm.createContext({AbortController,AbortSignal:{any:AbortSignal.any.bind(AbortSignal),timeout(ms){assert.equal(ms,30000);const timer=new AbortController();f.timeouts.push(timer);return timer.signal;}},crypto:{randomUUID},document:{createElement(tag){assert.equal(tag,'dialog');return dialog;},body:{append(element){element.isConnected=true;f.dialogs.push(element);}}},window:{addEventListener(){},removeEventListener(){}},fetch:async(url,options)=>{
  assert.equal(url,'https://tughscoxralhofrckvxy.supabase.co/functions/v1/cos-operations-pages');const body=JSON.parse(options.body);f.requests.push(body);assert.equal(body.method,'GET');assert.equal(body.body,null);assert.ok(['/api/field-map','/api/camera-health/summary-v3'].includes(body.path));
  const failed=f.failed.has(body.path),data=structuredClone(body.path==='/api/field-map'?f.snapshot:f.health);if(f.holdPath===body.path)await new Promise(resolve=>f.fetchHolds.push(resolve));return {ok:!failed,status:failed?503:200,json:async()=>data};
 }});
 vm.runInContext(source,context);
 Object.assign(f,{fields,nodes,form,dialog,open:()=>context.CameraPlacementControls.open({db,key,placement:'SHOP',onSaved:saved=>f.saved.push(saved)}),moves:()=>f.calls.filter(call=>call.name==='owner_set_camera_unit_placement_v2'),submit:()=>form.onsubmit({preventDefault(){}})});return f;
}

test('Shop uses saved identity reads, no new address or vendor request, and saves once after a fresh check',async()=>{
 const f=fixture();await f.open();assert.equal(f.nodes.save.disabled,false);assert.equal(f.fields.site.label.hidden,true);assert.equal(f.fields.address.label.hidden,true);assert.match(f.nodes.feedback.textContent,/No new installation address or live vendor lookup/);assert.equal(f.moves().length,0);
 f.fields.reason.value='Synthetic return';f.fields.confirmed.checked=true;await f.submit();assert.equal(f.moves().length,1);assert.equal(f.moves()[0].args.p_placement,'SHOP');assert.equal(f.moves()[0].args.p_site_label,'');assert.equal(f.moves()[0].args.p_street_address,'');assert.equal(f.requests.length,4);assert.equal(f.saved.length,1);assert.equal(f.dialog.isConnected,false);
});

test('a hung saved placement read is bounded and retries in the same dialog without accepting its late reply',async()=>{
 const f=fixture();f.holdLegacy=true;const opening=f.open();await until(()=>f.holds.length===1);assert.match(f.nodes.feedback.textContent,/30 seconds.*saved placement/);assert.equal(f.nodes.save.disabled,true);assert.equal(f.nodes.retry.hidden,true);
 f.timeouts[0].abort();await opening;assert.match(f.nodes.feedback.textContent,/timed out.*saved placement/);assert.equal(f.nodes.cancel.disabled,false);assert.equal(f.nodes.retry.hidden,false);assert.equal(f.moves().length,0);
 const oldReply=f.holds[0];f.holdLegacy=false;f.nodes.retry.onclick();await until(()=>!f.nodes.save.disabled);assert.equal(f.dialogs.length,1);assert.equal(f.fields.confirmed.checked,false);assert.equal(f.requests.length,4);const readyFeedback=f.nodes.feedback.textContent;oldReply();await turn();await turn();assert.equal(f.nodes.feedback.textContent,readyFeedback);assert.equal(f.moves().length,0);
});

test('source failure names the saved source and retry cannot bypass malformed identity',async()=>{
 const f=fixture();f.failed.add('/api/field-map');await f.open();assert.match(f.nodes.feedback.textContent,/Field Map inventory.*unavailable/);assert.equal(f.nodes.retry.hidden,false);assert.equal(f.nodes.save.disabled,true);
 f.failed.clear();f.health.identityWarnings.push({unitId:f.snapshot.inventoryItems[0].id,reason:'Synthetic identity warning',deviceIds:['9101'],unitKeys:[key]});f.nodes.retry.onclick();await until(()=>!f.nodes.retry.hidden);assert.match(f.nodes.feedback.textContent,/identity needs review/);assert.equal(f.nodes.save.disabled,true);await f.submit();assert.equal(f.moves().length,0);
});

test('a preflight source failure needs a full reread and new confirmation before it can write',async()=>{
 const f=fixture();await f.open();f.fields.reason.value='Synthetic return';f.fields.confirmed.checked=true;f.failed.add('/api/field-map');await f.submit();assert.equal(f.moves().length,0);assert.equal(f.nodes.retry.hidden,false);assert.equal(f.nodes.save.disabled,true);
 f.failed.clear();await f.submit();assert.equal(f.moves().length,0);f.nodes.retry.onclick();await until(()=>!f.nodes.save.disabled);assert.equal(f.fields.confirmed.checked,false);await f.submit();assert.equal(f.moves().length,0);f.fields.confirmed.checked=true;await f.submit();assert.equal(f.moves().length,1);assert.equal(f.saved.length,1);
});

test('a changed revision stays blocked until the user rereads and confirms the changed baseline',async()=>{
 const f=fixture();await f.open();f.fields.reason.value='Synthetic return';f.fields.confirmed.checked=true;f.snapshot.inventoryItems[0].address='200 Changed Synthetic Road';await f.submit();assert.match(f.nodes.feedback.textContent,/identity changed/);assert.equal(f.moves().length,0);
 f.nodes.retry.onclick();await until(()=>!f.nodes.save.disabled);assert.equal(f.fields.address.value,'200 Changed Synthetic Road');assert.equal(f.fields.confirmed.checked,false);await f.submit();assert.equal(f.moves().length,0);
});

test('changing account cannot be cleared by repeated verification retries',async()=>{
 const f=fixture();await f.open();f.fields.reason.value='Synthetic return';f.fields.confirmed.checked=true;f.subject='different-synthetic-owner';await f.submit();assert.equal(f.moves().length,0);
 for(let i=0;i<2;i++){f.nodes.retry.onclick();await until(()=>!f.nodes.retry.disabled);assert.equal(f.nodes.retry.hidden,true);assert.match(f.nodes.feedback.textContent,/account changed/);assert.equal(f.nodes.save.disabled,true);await f.submit();assert.equal(f.moves().length,0);}
});

test('after any attempted write the dialog cannot retry verification or replay the move',async()=>{
 const f=fixture();await f.open();f.fields.reason.value='Synthetic return';f.fields.confirmed.checked=true;f.denyWrite=true;await f.submit();assert.equal(f.moves().length,1);assert.equal(f.nodes.retry.hidden,true);assert.match(f.nodes.feedback.textContent,/could not be confirmed/);const reads=f.requests.length;
 f.nodes.retry.onclick();await f.submit();await turn();assert.equal(f.requests.length,reads);assert.equal(f.moves().length,1);assert.equal(f.saved.length,0);assert.equal(f.nodes.cancel.disabled,false);
});

test('cancelling a pending retry prevents its late reply from restoring controls',async()=>{
 const f=fixture();f.failed.add('/api/field-map');await f.open();f.failed.clear();f.holdLegacy=true;f.nodes.retry.onclick();await until(()=>f.holds.length===1);f.nodes.cancel.onclick();assert.equal(f.dialog.isConnected,false);const text=f.nodes.feedback.textContent;f.holds[0]();await turn();await turn();assert.equal(f.nodes.feedback.textContent,text);assert.equal(f.moves().length,0);
});

for(const phase of [1,2])test('the complete read deadline includes signed-in account phase '+phase,async()=>{
 const f=fixture();f.holdSessionAt=phase;const opening=f.open();await until(()=>f.sessionHolds.length===1);assert.match(f.nodes.feedback.textContent,phase===1?/signed-in account/:/signed-in account recheck/);f.timeouts[0].abort();await opening;
 assert.equal(f.nodes.save.disabled,true);assert.equal(f.nodes.retry.hidden,false);const requests=f.requests.length;f.sessionHolds[0]();await turn();await turn();assert.equal(f.requests.length,requests);assert.equal(f.moves().length,0);
 f.holdSessionAt=0;f.nodes.retry.onclick();await until(()=>!f.nodes.save.disabled);assert.equal(f.dialogs.length,1);assert.equal(f.moves().length,0);
});

test('a timed-out inventory reply cannot replace a newer retry baseline',async()=>{
 const f=fixture();f.holdPath='/api/field-map';const opening=f.open();await until(()=>f.fetchHolds.length===1);assert.match(f.nodes.feedback.textContent,/Field Map inventory/);f.timeouts[0].abort();await opening;
 f.holdPath='';f.snapshot.inventoryItems[0].address='300 New Saved Synthetic Road';f.nodes.retry.onclick();await until(()=>!f.nodes.save.disabled);assert.equal(f.fields.address.value,'300 New Saved Synthetic Road');f.fetchHolds[0]();await turn();await turn();assert.equal(f.fields.address.value,'300 New Saved Synthetic Road');assert.equal(f.moves().length,0);
});
