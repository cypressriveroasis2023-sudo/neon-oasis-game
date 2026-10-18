import test from 'node:test';
import assert from 'node:assert/strict';
import React from 'react';
import {renderToStaticMarkup} from 'react-dom/server';
import Alert from '../src/MhelpConnectionAlert.tsx';
const receipt={contract:'COS_MHELP_PLACEMENT_V1',errorCode:'source_read_unavailable'};
const render=(value,canReconnect=true)=>renderToStaticMarkup(React.createElement(Alert,{value,canReconnect,onReconnect:()=>{}}));
test('a failed token-managed inventory read shows a prominent Owner recovery action without claiming a camera outage',()=>{
 const html=render(receipt);assert.match(html,/role="alert"/);assert.match(html,/mHelpDesk connection needs attention/);assert.match(html,/Check or reconnect mHelpDesk/);assert.match(html,/camera health is separate/);
});
test('non-Owners see the failure and an Owner handoff without an authorization action',()=>{
 const html=render(receipt,false);assert.match(html,/Ask a COS Owner/);assert.doesNotMatch(html,/<button/);
});
test('rate limits request automatic retry without a reconnect alarm',()=>{
 const html=render({...receipt,errorCode:'source_rate_limited'});assert.match(html,/role="status"/);assert.match(html,/retry automatically/);assert.doesNotMatch(html,/role="alert"|reconnect/);
});
test('recovery and missing or unrelated receipts clear the alert',()=>{
 for(const value of [null,undefined,[],{},'failed',{...receipt,errorCode:null},{...receipt,errorCode:''},{...receipt,errorCode:{}},{...receipt,contract:'other'}])assert.equal(render(value),'');
});
test('arbitrary errors and extra source properties cannot expose credential strings',()=>{
 const html=render({...receipt,errorCode:'synthetic-private-token',accessToken:'synthetic-private-token',refreshToken:'synthetic-private-token',errorDescription:'synthetic-private-token'});assert.match(html,/role="alert"/);assert.doesNotMatch(html,/synthetic-private-token/);
});
