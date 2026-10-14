import assert from 'node:assert/strict';
import test from 'node:test';
import {setImmediate} from 'node:timers/promises';
import {readFileSync} from 'node:fs';
import vm from 'node:vm';
import ts from 'typescript';
const flush=()=>setImmediate();
const deferred=()=>{let resolve,reject;const promise=new Promise((a,b)=>{resolve=a;reject=b;});return {promise,resolve,reject};};
function productionAction(file,start,end,globalName){const source=readFileSync(new URL('../src/'+file,import.meta.url),'utf8');const slice=source.slice(source.indexOf(start),source.indexOf(end,source.indexOf(start)));assert.ok(slice.includes(start));return ts.transpileModule(slice+'\nexports.action='+globalName+';',{compilerOptions:{module:ts.ModuleKind.CommonJS,target:ts.ScriptTarget.ES2022}}).outputText;}
const gpsAction=productionAction('FieldMap.tsx','  const saveGps = async () => {','  const runApprovedCensus','saveGps');
function gpsFixture(){
 let epoch=0;const digest=deferred(),saved=deferred(),calls=[],messages=[],reads=[],busy=[],refreshLocks=[];
 const mounted={current:true},revision={current:0},context={current:{selectedId:'synthetic-unit'}},working={current:false};
 const saver={needsRefresh:false,owner:async(...args)=>{calls.push(args);return saved.promise;}};
 const exports={};vm.runInNewContext(gpsAction,{exports,Error,locationWritesEnabled:true,selected:{id:'synthetic-unit',unitNumber:'Synthetic Unit',address:'Synthetic address'},working,confirmedLocation:true,censusMounted:mounted,censusSessionRevision:revision,censusContext:context,api:{captureSession:()=>{const before=epoch;return()=>before===epoch;}},gpsSaver:{current:saver},locationVerificationNote:()=>digest.promise,gpsWrite:input=>input,lat:'29',lon:'-95',accuracy:'3',source:'manual',note:'Synthetic note',setBusy:value=>busy.push(value),setGpsMessage:()=>{},setError:()=>{},setData:()=>{},setRefreshRequired:value=>refreshLocks.push(value),cameras:{refresh:()=>reads.push('cameras')},onUpdated:()=>reads.push('parent'),show:message=>messages.push(message)},{filename:'FieldMap-exact-saveGps.tsx'});
 return {action:exports.action,digest,saved,calls,messages,reads,busy,refreshLocks,saver,mounted,revision,context,invalidate(){epoch++;}};
}
for(const boundary of ['session','hide','unmount','selection'])test('GPS digest continuation cannot submit across '+boundary,async()=>{
 const f=gpsFixture(),pending=f.action();if(boundary==='session')f.invalidate();if(boundary==='hide')f.revision.current++;if(boundary==='unmount')f.mounted.current=false;if(boundary==='selection')f.context.current.selectedId='other-unit';f.digest.resolve('verified synthetic note');await pending;assert.equal(f.calls.length,0);assert.deepEqual(f.messages,[]);assert.deepEqual(f.reads,[]);
});
test('GPS normal digest submits once, but invalidation before readback suppresses every old completion callback',async()=>{
 const f=gpsFixture(),pending=f.action();f.digest.resolve('verified synthetic note');await flush();assert.equal(f.calls.length,1);f.invalidate();f.saved.resolve({items:[]});await pending;assert.equal(f.calls.length,1);assert.deepEqual(f.messages,[]);assert.deepEqual(f.reads,[]);
});
test('GPS unchanged-session digest and readback retain the existing save behavior',async()=>{
 const f=gpsFixture(),pending=f.action();f.digest.resolve('verified synthetic note');await flush();f.saved.resolve({items:[]});await pending;assert.equal(f.calls.length,1);assert.match(f.messages[0],/saved and read back/);assert.deepEqual(f.reads,['cameras','parent']);
});
test('GPS pending digest clears busy after healthy hide and a new explicit save works on return',async()=>{
 const f=gpsFixture(),pending=f.action();assert.deepEqual(f.busy,[true]);f.invalidate();f.revision.current++;f.digest.resolve('verified synthetic note');await pending;assert.deepEqual(f.busy,[true,false]);assert.equal(f.calls.length,0);assert.deepEqual(f.messages,[]);assert.deepEqual(f.reads,[]);
 const next=f.action();await flush();assert.equal(f.calls.length,1);f.saved.resolve({items:[]});await next;assert.deepEqual(f.busy,[true,false,true,false]);assert.match(f.messages[0],/saved and read back/);
});
test('GPS uncertain save preserves its refresh lock but clears busy after healthy hide',async()=>{
 const f=gpsFixture(),pending=f.action();f.digest.resolve('verified synthetic note');await flush();assert.equal(f.calls.length,1);f.invalidate();f.revision.current++;f.saver.needsRefresh=true;f.saved.reject(new Error('Synthetic unverified save'));await pending;
 assert.deepEqual(f.busy,[true,false]);assert.deepEqual(f.refreshLocks,[true]);assert.deepEqual(f.messages,[]);assert.deepEqual(f.reads,[]);await f.action();assert.equal(f.calls.length,1);
});
const ownerAction=productionAction('OwnerBoardControls.tsx','  const run=async(','  const lifecycle=','run');
for(const boundary of ['session','unmount'])test('Owner confirmation/prepare continuation cannot submit across '+boundary,async()=>{
 let epoch=0;const prepared=deferred(),calls=[],mounted={current:true},exports={};
 vm.runInNewContext(ownerAction,{exports,Error,actionRunning:{current:false},activeReads:{current:0},mounted,api:{captureSession:()=>{const before=epoch;return()=>before===epoch;}},saver:{current:{needsRefresh:false,save:async action=>{calls.push(action);return {status:'confirmed'};}}},setBusy:()=>{},setError:()=>{},show:()=>assert.fail('Old confirmation may not show success'),window:{dispatchEvent:()=>assert.fail('Old confirmation may not publish an update')}},{filename:'OwnerBoardControls-exact-run.tsx'});
 const pending=exports.action('close',()=>prepared.promise);if(boundary==='session')epoch++;else mounted.current=false;prepared.resolve({action:{kind:'close'},message:'Synthetic saved'});await pending;assert.equal(calls.length,0);
});

function dialogFixture(){
 const listeners=new Map(),docListeners=new Map();
 const add=(map,type,fn)=>{if(!map.has(type))map.set(type,new Set());map.get(type).add(fn);};
 class Element{constructor(){this.children=[];this.isConnected=true;}append(...nodes){this.children.push(...nodes);for(const node of nodes)node.parent=this;}setAttribute(){}hasAttribute(){return false;}addEventListener(){}focus(){}querySelector(){return this.children.find(child=>child.tag==='button')||null;}querySelectorAll(){return this.children;}remove(){this.parent.children=this.parent.children.filter(child=>child!==this);this.isConnected=false;}}
 class Input extends Element{}class Textarea extends Element{}
 const body=new Element(),parent={};const window={parent,addEventListener:(type,fn)=>add(listeners,type,fn),removeEventListener:(type,fn)=>listeners.get(type)?.delete(fn)};
 const document={body,activeElement:new Element(),createElement(tag){const value=tag==='input'?new Input():tag==='textarea'?new Textarea():new Element();value.tag=tag;return value;},addEventListener:(type,fn)=>add(docListeners,type,fn),removeEventListener:(type,fn)=>docListeners.get(type)?.delete(fn)};
 const exports={},source=ts.transpileModule(readFileSync(new URL('../src/cosDialog.ts',import.meta.url),'utf8'),{compilerOptions:{module:ts.ModuleKind.CommonJS,target:ts.ScriptTarget.ES2022}}).outputText;
 vm.runInNewContext(source,{exports,window,document,location:{origin:'https://synthetic.example'},HTMLElement:Element,HTMLInputElement:Input,HTMLTextAreaElement:Textarea},{filename:'cosDialog.ts'});
 return {...exports,body,parent,listeners,emit(type,extra={}){for(const fn of [...listeners.get(type)||[]])fn({type,...extra});}};
}
for(const kind of ['cosConfirm','cosPrompt'])for(const boundary of ['cos-private-data-invalidated','pagehide','trusted-hide'])test(kind+' closes its private DOM and cancels on '+boundary,async()=>{
 const f=dialogFixture(),pending=f[kind]('Synthetic private record');assert.equal(f.body.children.length,1);
 if(boundary==='trusted-hide'){
  f.emit('message',{origin:'https://untrusted.example',source:f.parent,data:{type:'COS_OPERATIONS_HIDE_PRIVATE_EVIDENCE'}});assert.equal(f.body.children.length,1);
  f.emit('message',{origin:'https://synthetic.example',source:f.parent,data:{type:'COS_OPERATIONS_HIDE_PRIVATE_EVIDENCE'}});
 }else f.emit(boundary);
 assert.equal(await pending,kind==='cosConfirm'?false:null);assert.equal(f.body.children.length,0);assert.ok([...f.listeners.values()].every(set=>set.size===0));
});

const importCapture=productionAction('MhelpTicketImport.tsx','  const captureAction=()=>{','  const directory=','captureAction');
test('import action lease cancels pending bytes on healthy hide, permits a fresh action on return, and rejects hard invalidation',async()=>{
 const {mhelpImportClient}=await import('../src/mhelpImportClient.ts');
 let epoch=0;const exports={},mounted={current:true},valid={current:true},revision={current:0},calls=[],bytes=deferred();
 const attachment={id:'10000000-0000-4000-8000-000000000001',organizationId:'20000000-0000-4000-8000-000000000001',sha256:'a'.repeat(64),byteLength:1,state:'staged',recoverable:true};
 const api={captureSession:()=>{const before=epoch;return()=>before===epoch;},get:async()=>({data:null}),post:async(...args)=>{calls.push(args);return {data:attachment};}};
 vm.runInNewContext(importCapture,{exports,api,mounted,importSessionValid:valid,revision,mhelpImportClient});
 const beforeHide=exports.action(),pending=beforeHide.client.stage(attachment.id,{}, {arrayBuffer:()=>bytes.promise});
 epoch++;revision.current++;bytes.resolve(new Uint8Array([1]).buffer);await assert.rejects(pending,/session changed/);assert.equal(calls.length,0);assert.equal(beforeHide.current(),false);
 const afterReturn=exports.action();assert.equal(afterReturn.current(),true);await afterReturn.client.stage(attachment.id,{}, {arrayBuffer:async()=>new Uint8Array([1]).buffer});assert.equal(calls.length,1);
 valid.current=false;epoch++;revision.current++;assert.equal(afterReturn.current(),false);const hardStopped=exports.action();assert.equal(hardStopped.current(),false);await assert.rejects(hardStopped.client.stage(attachment.id,{}, {arrayBuffer:async()=>new Uint8Array([1]).buffer}),/session changed/);assert.equal(calls.length,1);
});
test('every multi-step import action captures its lease before preparation',()=>{
 const source=readFileSync(new URL('../src/MhelpTicketImport.tsx',import.meta.url),'utf8');
 for(const [name,end] of [['save','checkResult'],['checkResult','cleanup'],['cleanup','restore'],['restore','download'],['download','selectedSite']]){
  const action=source.slice(source.indexOf('  const '+name+'=async('),source.indexOf('  const '+end,source.indexOf('  const '+name+'=async(')));
  assert.ok(action.indexOf('captureAction()')<action.indexOf('await '),name+' must capture the originating action before its first await');assert.match(action,/actionCurrent\(\)/);
 }
 const hidden=source.match(/const hidden=.*;/)?.[0]||'';assert.match(hidden,/revision\.current\+\+/);assert.doesNotMatch(hidden,/invalid\(/);
});

const ownerLifecycle=productionAction('OwnerBoardControls.tsx','  const lifecycle=','  useEffect(()=>{','lifecycle');
const ownerTruck=productionAction('OwnerBoardControls.tsx','  const approveTruck=','  useEffect(()=>{','approveTruck');
for(const action of ['close','remove','truck'])test('old Owner '+action+' prompt continuation cannot reopen a private confirmation after invalidation',async()=>{
 const prompted=deferred(),exports={},confirmations=[];let current=true;
 const context={exports,Error,run:async(_key,prepare)=>prepare(()=>current),cosPrompt:()=>prompted.promise,cosConfirm:async text=>{confirmations.push(text);return true;}};
 vm.runInNewContext(action==='truck'?ownerTruck:ownerLifecycle,context);
 const pending=action==='truck'?exports.action({id:'synthetic-check',technician:'Synthetic technician'}):exports.action({jobNumber:'COS-123'},action);
 prompted.resolve(action==='remove'?'DELETE COS-123':'Synthetic note');current=false;assert.equal(await pending,null);assert.deepEqual(confirmations,[]);
});
