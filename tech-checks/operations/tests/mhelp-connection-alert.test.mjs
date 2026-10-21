import test from 'node:test';
import assert from 'node:assert/strict';
import React from 'react';
import {renderToStaticMarkup} from 'react-dom/server';
import Alert from '../src/MhelpConnectionAlert.tsx';
const receipt={contract:'COS_MHELP_PLACEMENT_V1',errorCode:'source_read_unavailable'};
const reliability={contract:'COS_MHELP_RELIABILITY_STATUS_V1',auth:{state:'reconnect_required'},inventory:{paused:false}};
const render=(value,canReconnect=true)=>renderToStaticMarkup(React.createElement(Alert,{value,canReconnect,onReconnect:()=>{}}));
test('generic source failures never ask for token replacement',()=>{
 for(const errorCode of ['source_read_unavailable','inventory_source_unavailable','transport_failure','503','invalid_grant']){
  const html=render({...receipt,errorCode});assert.match(html,/role="status"/);assert.match(html,/camera health is separate/);assert.doesNotMatch(html,/reconnect|<button|role="alert"/i);
 }
});
test('persisted current rejected grant shows Owner reconnect even without source error',()=>{
 const html=render({...receipt,errorCode:null,reliability});assert.match(html,/role="alert"/);assert.match(html,/>Reconnect mHelpDesk<\/button>/);assert.match(html,/camera health is separate/);
});
test('non-Owners receive a handoff without an authorization action',()=>{
 const html=render({...receipt,reliability},false);assert.match(html,/Ask a COS Owner to reconnect/);assert.doesNotMatch(html,/<button/);
});
test('rate limits request automatic retry without a reconnect alarm',()=>{
 const html=render({...receipt,errorCode:'source_rate_limited'});assert.match(html,/role="status"/);assert.match(html,/retry automatically/);assert.doesNotMatch(html,/role="alert"|reconnect/);
});
test('pause takes priority over source failures and unknown retry times are not invented',()=>{
 const html=render({...receipt,reliability:{...reliability,auth:{state:'verified'},inventory:{paused:true}}});assert.match(html,/updates paused/);assert.doesNotMatch(html,/retry|reconnect/i);
});
test('known eligibility shows its exact instant without claiming a scheduled completion',t=>{
 t.mock.method(Date,'now',()=>Date.parse('2026-10-20T23:00:00Z'));
 const retry='2026-10-21T00:00:00Z';const html=render({...receipt,reliability:{...reliability,auth:{state:'verified'},inventory:{paused:false,nextEligibleAt:retry}}});assert.match(html,/eligible at/);assert.match(html,/dateTime="2026-10-21T00:00:00Z"/);assert.doesNotMatch(html,/reconnect/i);
});
test('elapsed or invalid eligibility never appears as a future automatic retry',t=>{
 t.mock.method(Date,'now',()=>Date.parse('2026-10-21T00:00:00Z'));
 for(const nextEligibleAt of ['2026-10-20T23:59:59Z','2026-10-21T00:00:00Z','not-a-date']){
  const html=render({...receipt,reliability:{...reliability,auth:{state:'verified'},inventory:{paused:false,nextEligibleAt}}});assert.match(html,/updates could not finish/);assert.doesNotMatch(html,/eligible at|<time|reconnect/i);
 }
});
test('recovery and unrelated receipts clear the alert',()=>{
 for(const value of [null,undefined,[],{},'failed',{...receipt,errorCode:null},{...receipt,errorCode:''},{...receipt,errorCode:{}},{...receipt,contract:'other'}])assert.equal(render(value),'');
});
test('untrusted auth text or errors cannot expose credentials or trigger reconnect',()=>{
 const html=render({...receipt,errorCode:'synthetic-private-token',accessToken:'synthetic-private-token',reliability:{...reliability,contract:'other'}});assert.match(html,/role="status"/);assert.doesNotMatch(html,/synthetic-private-token|reconnect|<button/i);
});

test('a transient renewal check failure has a clear alert without reconnect or discarded saved data',()=>{const html=render({...receipt,errorCode:null,reliability:{...reliability,auth:{state:'verified',renewalCheckFailed:true},inventory:{paused:true}}});assert.match(html,/Automatic renewal check delayed/);assert.match(html,/role="alert"/);assert.doesNotMatch(html,/reconnect|<button/i);});
