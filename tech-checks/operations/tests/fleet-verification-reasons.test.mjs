import test from 'node:test';
import assert from 'node:assert/strict';
import {runFleetVerification,verificationOutcomeLabel} from '../src/fleetVerificationRun.ts';
const products=[{productId:'11',unitNumber:'Test unit'}];
const base={current:()=>true,readback:async()=>{}};
test('a lost API response retains its bounded explanation without replaying the check',async()=>{
 let calls=0;
 const message='Verification source temporarily unavailable.';
 const error=Object.assign(new Error(message),{name:'OperationsApiError',response:{status:503,data:{error:message}}});
 const result=await runFleetVerification(products,{...base,check:async()=>{calls++;throw error;}});
 assert.equal(calls,1);assert.equal(result.online,0);assert.equal(result.notConfirmed,1);
 assert.match(result.rows[0].reason,/Verification source temporarily unavailable\./);
 assert.match(result.rows[0].reason,/request was not repeated/);
});
test('untrusted and oversized error details are not copied into results',async()=>{
 for(const error of [new Error('raw private payload'),{response:{status:503,data:{error:'raw payload'}}},Object.assign(new Error('x'.repeat(501)),{name:'OperationsApiError',response:{data:{error:'x'.repeat(501)}}}),Object.assign(new Error('<html>'),{name:'OperationsApiError',response:{data:{error:'<html>'}}})]){
  const result=await runFleetVerification(products,{...base,check:async()=>{throw error;}});
  assert.ok(result.rows[0].reason.startsWith('This request did not return'));
 }
});
test('missing setup and failed checks have different labels without changing status',()=>{
 const row={productId:'11',name:'Test unit',status:'unknown',checkedAt:null,outcome:'returned'};
 for(const reason of ['No verified public tracker IP is available. Open the record to correct it.','Saved camera IP or port configuration needs correction. Open the equipment record.'])assert.equal(verificationOutcomeLabel({...row,reason}),'Needs correction');
 for(const reason of ['A connection check could not complete.','No fresh, completed check is available.','Equipment identity or placement is held for review.'])assert.equal(verificationOutcomeLabel({...row,reason}),'Unresolved');
 assert.equal(verificationOutcomeLabel({...row,reason:'',outcome:'not_confirmed'}),'Check not confirmed');
 assert.equal(verificationOutcomeLabel({...row,reason:'',status:'offline'}),'Offline');
});
