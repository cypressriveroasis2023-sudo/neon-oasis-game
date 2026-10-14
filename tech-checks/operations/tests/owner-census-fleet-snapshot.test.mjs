import assert from 'node:assert/strict';
import test from 'node:test';
import {readFileSync} from 'node:fs';
import {createRequire} from 'node:module';
import {fileURLToPath} from 'node:url';
import {setImmediate} from 'node:timers/promises';
import vm from 'node:vm';
const root=fileURLToPath(new URL('..',import.meta.url));
const require=createRequire(root+'/package.json'),ts=require('typescript');
const {reconcileFleetSnapshot}=await import(root+'/src/fleetSnapshot.ts');
const {validateCameraHealth}=await import(root+'/src/fieldCameraHealth.ts');
const {checkedFieldMap}=await import(root+'/src/gpsPersistence.ts');
const {checkedOwnerCensusPreparationBinding,createOwnerCensusPreparation}=await import(root+'/src/ownerCensusPreparation.ts');
const {automaticRefreshDue,CAMERA_AUTO_REFRESH_MS}=await import(root+'/src/refreshCadence.ts');
const {fixture:preparationSnapshot,id,now,preparationOwner,receipt}=await import(root+'/tests/owner-census-preparation-fixtures.mjs');
const source=ts.transpileModule(readFileSync(root+'/src/api.ts','utf8'),{compilerOptions:{module:ts.ModuleKind.CommonJS,target:ts.ScriptTarget.ES2022}}).outputText;
const fixtureSource=readFileSync(root+'/tests/api-inflight-reads.test.mjs','utf8');
const fixtureBody=fixtureSource.slice(fixtureSource.indexOf('function fixture('),fixtureSource.indexOf("\ntest('identical safe reads"));
let observationClock=now;class ClockDate extends Date{static now(){return observationClock;}}
const apiFixture=new Function('assert','vm','source','reconcileFleetSnapshot','validateCameraHealth','checkedFieldMap','deferred','clockDate','CAMERA_AUTO_REFRESH_MS',fixtureBody.replace('Date: class extends Date { static now() { return clock; } },','Date:clockDate,')+'; return fixture;')(assert,vm,source,reconcileFleetSnapshot,validateCameraHealth,checkedFieldMap,deferred,ClockDate,CAMERA_AUTO_REFRESH_MS);
const flush=()=>setImmediate();function deferred(){let resolve,reject;const promise=new Promise((y,n)=>{resolve=y;reject=n;});return {promise,resolve,reject};}
function expression(file,name){const text=readFileSync(root+'/src/'+file,'utf8'),tree=ts.createSourceFile(file,text,ts.ScriptTarget.Latest,true,ts.ScriptKind.TSX);let found;function visit(node){if(ts.isVariableDeclaration(node)&&node.name.getText(tree)===name)found=node.initializer;ts.forEachChild(node,visit);}visit(tree);assert(found,name);const node=name==='refresh'?found.arguments[0]:found;return ts.transpileModule('const extractedFunction='+node.getText(tree)+';', {compilerOptions:{target:ts.ScriptTarget.ES2022,module:ts.ModuleKind.CommonJS}}).outputText+'; return extractedFunction;';}
const {sameFieldMapSourceSnapshot}=await import(root+'/src/fieldMapSnapshot.ts');
const fieldSource=readFileSync(root+'/src/FieldMap.tsx','utf8');
const fleetEffect=/useEffect\(\(\)=>\{([^\n]*?)\},\[cameras\.fleet\]\);/.exec(fieldSource);assert(fleetEffect);
const effectBody=ts.transpileModule(fleetEffect[1],{compilerOptions:{target:ts.ScriptTarget.ES2022}}).outputText;
const visibleBody=['preparationBinding','visiblePreparation','visiblePreparationMessage'].map(name=>{const line=fieldSource.split('\n').find(s=>s.trimStart().startsWith('const '+name+'='));assert(line);return line;}).join('\n')+'\nreturn {preparationBinding,visiblePreparation,visiblePreparationMessage};';
const visibleFn=new Function('ownerCensusEnabled','censusSessionInvalid','preparationReady','preparationReceipt','preparationMessage','data','selectedId',visibleBody);
const health={totalDevices:0,online:0,offline:0,review:0,shopRoot:0,healthRows:0,fieldDevices:0,refreshedAt:new Date(now).toISOString(),rows:[],evidenceVersion:2,inventory:{allRecords:0,activeFieldRecords:0,activeShopRecords:0,inactiveRecords:0,unknownScopeRecords:0}};
async function ui(f){
 const initial=preparationSnapshot().snapshot,state={data:initial,selectedId:id,busy:false,message:null,receipt:null,ready:null,error:'',fleet:null,sessionInvalid:false},working={current:false};
 const context={current:{data:initial,selectedId:id,ownerCensusEnabled:true}},sessionRevision={current:0},preparationSnapshotLock={current:null},automaticReadPaused={current:false},mounted={current:true},preparation={current:createOwnerCensusPreparation(f.api,()=>now)};
 const setData=value=>{if(typeof value==='function')value=value(state.data);state.data=value;context.current.data=value;};
 const setReady=value=>state.ready=value,setMessage=value=>state.message=value,setReceipt=value=>state.receipt=value;
 const prepareFn=new Function('working','preparationBinding','data','selected','censusSessionRevision','censusMounted','censusContext','setBusy','setPreparationReady','setPreparationReceipt','setPreparationMessage','censusPreparation','setData','preparationSnapshotLock',expression('FieldMap.tsx','prepareApprovedCensus'));
 const effect=new Function('cameras','setData','sameFieldMapSourceSnapshot','working','preparationSnapshotLock','automaticReadPaused',effectBody);
 const running={current:false},revision={current:0},lastAttemptAt={current:now};
 const refresh=new Function('Date','api','running','lastAttemptAt','revision','setLoading','validateCameraHealth','setFleet','setError','updateClock',expression('useCameraHealth.ts','refresh'))(ClockDate,f.api,running,lastAttemptAt,revision,()=>{},validateCameraHealth,value=>{state.fleet=value;if(!state.deferFleetEffect)effect({fleet:value},setData,sameFieldMapSourceSnapshot,working,preparationSnapshotLock,automaticReadPaused);},value=>state.error=value,()=>{});
 const invalidate=new Function('censusSessionRevision','censusAction','censusPreparation','setCensusSessionInvalid','setCensusReady','setCensusMessage','setPreparationReady','setPreparationMessage','setPreparationReceipt','preparationSnapshotLock',expression('FieldMap.tsx','invalidate'))(sessionRevision,{current:{invalidate(){}}},preparation,value=>state.sessionInvalid=value,()=>{},()=>{},setReady,setMessage,setReceipt,preparationSnapshotLock);f.window.addEventListener('cos-private-data-invalidated',invalidate);
 const selectionEffect=/useEffect\(\(\)=>\{([^\n]*?)\},\[selectedId\]\);/.exec(fieldSource);assert(selectionEffect);
 const selectChanged=()=>new Function('preparationSnapshotLock','censusAction','censusPreparation','setCensusMessage','setPreparationMessage',selectionEffect[1])(preparationSnapshotLock,{current:{invalidate(){}}},preparation,()=>{},setMessage);
 const load=(force=false)=>new Function('api','working','lastAttemptAt','setBusy','setError','setCensusMessage','setPreparationReceipt','setPreparationMessage','preparationSnapshotLock','setData','setCensusSessionInvalid','gpsSaver','setRefreshRequired','initialUnitLabel','initialUnitId','data','setSelectedId','sameFieldMapSourceSnapshot',expression('FieldMap.tsx','load'))(f.api,working,lastAttemptAt,value=>state.busy=value,value=>state.error=value,()=>{},setReceipt,setMessage,preparationSnapshotLock,setData,value=>state.sessionInvalid=value,{current:{acknowledgeRefresh(){},needsRefresh:false}},()=>{},'','',state.data,value=>state.selectedId=typeof value==='function'?value(state.selectedId):value,sameFieldMapSourceSnapshot)(force);
 const bind=async()=>{const binding=state.sessionInvalid?null:await checkedOwnerCensusPreparationBinding(state.data,id);state.ready=binding?{snapshot:state.data,unitId:id,binding}:null;};await bind();
 return {state,working,preparationSnapshotLock,automaticReadPaused,selectChanged,load,context,sessionRevision,preparation,refresh,lastAttemptAt,bind,selectData:setData,effect:value=>effect({fleet:value},setData,sameFieldMapSourceSnapshot,working,preparationSnapshotLock,automaticReadPaused),visible:()=>visibleFn(true,state.sessionInvalid,state.ready,state.receipt,state.message,state.data,id),start:()=>prepareFn(working,state.ready.binding,state.data,state.data.items.find(row=>row.id===id),sessionRevision,mounted,context,value=>state.busy=value,setReady,setReceipt,setMessage,preparation,setData,preparationSnapshotLock)()};
}
async function boot(){observationClock=now;const f=apiFixture(),u=await ui(f);const field=f.api.fleetSource('fieldMap'),camera=u.refresh();await flush();f.answer(1,u.state.data);const loaded=await field;u.selectData(loaded);f.answer(0,health);await camera;await u.bind();return {f,u};}
async function waitRequest(f,index){for(let attempt=0;attempt<200&&!f.requests[index];attempt++)await new Promise(resolve=>setTimeout(resolve,1));assert.ok(f.requests[index],'expected request '+index);}
async function answerSession(f,index){await waitRequest(f,index);assert.equal(f.requests[index].envelope.path,'/api/session');f.answer(index,preparationOwner);await flush();}

test('same initial pair and a cache hit preserve exact map identity and preparation marker',async()=>{
 const f=apiFixture(),u=await ui(f),field=f.api.fleetSource('fieldMap'),camera=u.refresh();await flush();f.answer(1,u.state.data);const loaded=await field;u.selectData(loaded);f.answer(0,health);await camera;
 assert.equal(u.state.data,loaded);assert.ok(await checkedOwnerCensusPreparationBinding(u.state.data,id));const count=f.requests.length;await u.refresh();assert.equal(u.state.data,loaded);assert.equal(f.requests.length,count);
});
test('ordinary Prepare map GET publishes no fleet event and changes no displayed identity',async()=>{
 const {f,u}=await boot(),before=u.state.data,events=f.invalidations.length;const read=f.api.get('/api/field-map');await flush();f.answer(2,structuredClone(before));await read;assert.equal(f.invalidations.length,events);assert.equal(u.state.data,before);
});
for(const drift of ['unchanged','address','marker','historical GPS','alias','global proof','other source','selection','session'])test('semantic admission preserves source/session/selection boundary: '+drift,async()=>{
 const {f,u}=await boot(),before=u.state.data,action=u.start();await flush();await answerSession(f,2);await waitRequest(f,3);
 observationClock=now+16*60000;const camera=u.refresh();await flush();const fresh=structuredClone(before);fresh.generatedAt=new Date(observationClock).toISOString();
 if(drift==='address')fresh.items[0].address='999 Changed Synthetic Street, Test City, TX 77002';
 if(drift==='marker')delete fresh.items[0].locationGeocode.censusPreparation;
 if(drift==='historical GPS')fresh.items[0].historicalLatitude=1;
 if(drift==='alias')fresh.nativePlacementAliases=[{unitId:id,unitKey:'CHANGED'}];
 if(drift==='global proof')fresh.ownerCensusProofs=[{nativeUnitId:id}];
 if(drift==='other source')fresh.summary.additionalAuthority='changed';
 if(drift==='selection'){u.context.current.selectedId='22222222-2222-4222-8222-222222222222';u.selectChanged();}
 if(drift==='session')f.window.dispatchEvent(new Event('cos-private-data-invalidated'));
 f.answer(4,health);f.answer(5,fresh);await camera;
 if(drift==='unchanged')assert.equal(u.state.data,before);else if(!['selection','session'].includes(drift))assert.notEqual(u.state.data,before);
 f.answer(3,structuredClone(before));
 if(drift==='unchanged'){
  await answerSession(f,6);await waitRequest(f,7);assert.equal(f.requests[7].envelope.method,'POST');f.answer(7,receipt());await waitRequest(f,8);f.answer(8,structuredClone(before));await answerSession(f,9);await action;
  assert.ok(u.state.receipt);assert.match(u.visible().visiblePreparationMessage,/eligible for review/);assert.equal(f.requests.filter(r=>r.envelope.method==='POST').length,1);
 }else{await action;assert.equal(u.state.receipt,null);assert.equal(f.requests.filter(r=>r.envelope.method==='POST').length,0);}
});
test('equality ignores only the top-level clock and object key ordering',()=>{
 const a=preparationSnapshot().snapshot,b=structuredClone(a);b.generatedAt='2026-10-13T13:00:00Z';assert(sameFieldMapSourceSnapshot(a,b));assert(sameFieldMapSourceSnapshot(a,Object.fromEntries(Object.entries(b).reverse())));
 b.items[0].generatedAt='a nested source timestamp';assert(!sameFieldMapSourceSnapshot(a,b));assert(!sameFieldMapSourceSnapshot(null,a));
});

test('real same-role parent token rollover clears preparation without clearing selected detail',async()=>{
 const {f,u}=await boot(),before=u.state.data,action=u.start();await flush();f.state.token='synthetic-renewed-same-role-session';await answerSession(f,2);await waitRequest(f,3);
 assert(f.invalidations.includes('cos-private-data-invalidated'));assert.equal(u.state.data,before);assert.equal(u.state.selectedId,id);assert.equal(u.state.sessionInvalid,true);f.answer(3,structuredClone(before));await action;await u.bind();
 assert.equal(u.visible().preparationBinding,null);assert.equal(u.visible().visiblePreparationMessage,null);assert.equal(u.state.receipt,null);assert.equal(f.requests.filter(r=>r.envelope.method==='POST').length,0);
});
test('a fleet pair begun before Prepare POST cannot publish after its revision fence',async()=>{
 const {f,u}=await boot(),before=u.state.data,pair=f.api.fleet(true),denied=assert.rejects(pair,error=>error.response.status===409);await flush();
 const post=f.api.post('/api/field-map/'+id+'/owner-census-prepare',{});await flush();f.answer(2,health);f.answer(3,structuredClone(before));await denied;f.answer(4,receipt());await post;
 assert.equal(u.state.data,before);assert.equal(f.invalidations.filter(type=>type==='cos-fleet-snapshot-updated').length,1,'only the initial complete pair published');
});

test('retains ordinary idle fleet adoption and its new read clock',async()=>{
 const {f,u}=await boot(),before=u.state.data;observationClock=now+16*60000;const camera=u.refresh();await flush();const fresh=structuredClone(before);fresh.generatedAt=new Date(observationClock).toISOString();f.answer(2,health);f.answer(3,fresh);await camera;
 assert.notEqual(u.state.data,before);assert.equal(u.state.data.generatedAt,fresh.generatedAt);assert.equal(u.state.busy,false);
});

for(const delayed of [false,true])for(const outcome of ['receipt','source_hold'])test('fleet effect '+(delayed?'after finally':'during POST')+' preserves visible '+outcome,async()=>{
 const {f,u}=await boot(),before=u.state.data,action=u.start();await flush();await answerSession(f,2);f.answer(3,structuredClone(before));await answerSession(f,4);await waitRequest(f,5);
 observationClock=now+16*60000;u.state.deferFleetEffect=delayed;const camera=u.refresh();await flush();const same=structuredClone(before);same.generatedAt=new Date(observationClock).toISOString();f.answer(6,health);f.answer(7,same);await camera;
 f.answer(5,outcome==='receipt'?receipt():{error:'synthetic private rejected detail'},outcome==='receipt'?200:409);
 if(outcome==='receipt'){await waitRequest(f,8);f.answer(8,structuredClone(before));await answerSession(f,9);}
 await action;assert.equal(u.working.current,false);const displayed=u.state.data;assert.equal(u.preparationSnapshotLock.current,displayed);u.effect(u.state.fleet);
 assert.equal(u.state.data,displayed);assert.match(u.visible().visiblePreparationMessage,outcome==='receipt'?/eligible for review/:/Preparation is on hold/);assert.equal(Boolean(u.state.receipt),outcome==='receipt');assert.equal(f.requests.filter(r=>r.envelope.method==='POST').length,1);
 if(outcome==='receipt'){
  const automaticCount=f.requests.length,automatic=u.load(false);assert.equal(u.preparationSnapshotLock.current,displayed);assert.ok(u.state.receipt);await waitRequest(f,automaticCount+1);f.answer(automaticCount,health);f.answer(automaticCount+1,structuredClone(same));await automatic;assert.equal(u.state.data,displayed);assert.ok(u.visible().visiblePreparation);
  if(delayed){
   observationClock+=16*60000;const count=f.requests.length,automaticChanged=u.load(false);await waitRequest(f,count+1);const changedSource=structuredClone(same);changedSource.items[0].historicalLatitude=1;f.answer(count,health);f.answer(count+1,changedSource);await automaticChanged;assert.equal(u.preparationSnapshotLock.current,null);assert.equal(u.state.receipt,null);assert.equal(u.state.message,null);assert.equal(u.state.data.items[0].historicalLatitude,1);
  }
  const count=f.requests.length,refresh=u.load(true);assert.equal(u.preparationSnapshotLock.current,null);assert.equal(u.state.receipt,null);assert.equal(u.state.message,null);await waitRequest(f,count+1);f.answer(count,health);f.answer(count+1,structuredClone(same));await refresh;assert.notEqual(u.state.data,displayed);assert.equal(u.state.data.generatedAt,same.generatedAt);
 }
 // Any real source change wins even with a visible receipt/message lock.
 const changed=structuredClone(same);delete changed.items[0].locationGeocode.censusPreparation;u.effect({...u.state.fleet,fieldMap:changed});assert.equal(u.state.data,changed);assert.equal(u.preparationSnapshotLock.current,null);assert.equal(u.visible().visiblePreparationMessage,null);assert.equal(u.visible().visiblePreparation,null);
});


test('dirty installation inputs keep the displayed snapshot until the existing pause clears',async()=>{
 const {u}=await boot(),before=u.state.data;u.automaticReadPaused.current=true;const changed=structuredClone(before);changed.items[0].address='Changed while the draft is dirty';u.effect({...u.state.fleet,fieldMap:changed});assert.equal(u.state.data,before);u.automaticReadPaused.current=false;u.effect({...u.state.fleet,fieldMap:changed});assert.equal(u.state.data,changed);
});
