import test from 'node:test';
import assert from 'node:assert/strict';
import vm from 'node:vm';
import {traverseIframeHistory} from './helpers/iframeHistory.mjs';

for (const direction of ['back','forward']) test(`iframe history ${direction} uses Locator.evaluate element and explicit argument separately`, async()=>{
  const location={hash:'#initial'},calls=[];
  const history={back(){calls.push('back');location.hash='#unit-tracker';},forward(){calls.push('forward');location.hash='#field-map';}};
  const frame={locator(selector){assert.equal(selector,'body');return {async evaluate(fn,arg){
    // Playwright Locator.evaluate always supplies the element first, argument second.
    return vm.runInNewContext('('+fn.toString()+')',{history,location})({tagName:'BODY'},arg);
  }};}};
  await traverseIframeHistory(frame,direction,direction==='back'?'#unit-tracker':'#field-map');
  assert.deepEqual(calls,[direction]);
});
test('iframe history rejects unsupported traversal before touching the document',async()=>{
  await assert.rejects(()=>traverseIframeHistory({locator(){throw new Error('document touched');}},'reload','#unit-tracker'),/Unsupported history direction/);
});
