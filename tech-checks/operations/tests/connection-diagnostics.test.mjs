import test from 'node:test';import assert from 'node:assert/strict';
import {readConnectionDiagnostic,connectionDiagnosticText} from '../src/connectionDiagnostics.ts';
import {readScopePreview,createScopePreview} from '../src/productScopePreviewModel.ts';
const diagnostic={stage:'product_native_binding',code:'binding_absent'};
const held={contract:'COS_PRODUCT_TCP_PREVIEW_V1',productIds:['101'],groups:[],held:[{productId:'101',reason:'product_native_binding_hold',diagnostic}]};
test('allowlisted pairs only; raw errors, extra fields, inherited keys and cross-stage codes are discarded',()=>{
 assert.deepEqual(readConnectionDiagnostic(diagnostic),diagnostic);
 for(const value of [null,[],{},'secret',new Error('secret'),{stage:'__proto__',code:'secret'},{stage:'tracker_census',code:'binding_absent'},{...diagnostic,message:'secret'},{...diagnostic,code:'<script>secret</script>'},Object.create(diagnostic)]){assert.equal(readConnectionDiagnostic(value),undefined);assert.equal(connectionDiagnosticText(value),'');}
});
test('held reason and exact Product ID are unchanged; old responses stay compatible',()=>{
 assert.deepEqual(readScopePreview(held,'101'),{kind:'held',reason:'product_native_binding_hold',diagnostic});
 const old=structuredClone(held);delete old.held[0].diagnostic;assert.deepEqual(readScopePreview(old,'101'),{kind:'held',reason:'product_native_binding_hold'});
 const bad=structuredClone(held);bad.held[0].diagnostic={...diagnostic,secret:'private'};assert.deepEqual(readScopePreview(bad,'101'),readScopePreview(old,'101'));
 assert.throws(()=>readScopePreview(held,'102'));
});

test('preview errors show only bounded diagnostics; session/cancel fences suppress even valid late diagnostics',async()=>{
 for(const mode of ['failure','cancel','session','malicious']){
  let reject,current=true;const states=[],api={captureSession:()=>()=>current,post:()=>new Promise((_,r)=>reject=r)},action=createScopePreview(api,'101',s=>states.push(s)),pending=action.load();
  if(mode==='cancel')action.clear();if(mode==='session')current=false;
  reject({message:'SECRET_RAW_ERROR',response:{data:{error:'SECRET_RAW_ERROR'}},diagnostic:mode==='malicious'?{stage:'tracker_census',code:'SECRET_RAW_ERROR'}:{stage:'preview_source',code:'source_unavailable'}});await pending;
  assert.doesNotMatch(JSON.stringify(states),/SECRET_RAW_ERROR/);assert.equal(states.some(s=>s.status==='ready'),false);
  if(['cancel','session'].includes(mode))assert.equal(states.at(-1).status,'idle');else{assert.equal(states.at(-1).status,'error');assert.equal(!!states.at(-1).diagnostic,mode!=='malicious');}
 }
});
