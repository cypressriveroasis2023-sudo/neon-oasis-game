import test from 'node:test';
import assert from 'node:assert/strict';
import {createElement} from 'react';
import {renderToStaticMarkup} from 'react-dom/server';
import {tvAuthDecision,tvNetworkBackoff,tvGatewayBackoff,tvSavedReadRetry,isTvTransportFailure,TV_WATCHDOG_MS,TV_RELOGIN_DEADLINE_MS,TV_SIGN_IN_PROMPT,TvFleetErrorBoundary} from '../src/tvResilience.tsx';

test('a token refresh keeps the board',()=>{
  assert.equal(tvAuthDecision('token-renewed',false),'keep');
  assert.equal(tvAuthDecision('token-renewed',true),'keep');
});

test('the first 401 keeps the board for one silent re-login',()=>{
  assert.equal(tvAuthDecision('authentication-denied',false),'retry-sign-in');
});

test('a 401 after the silent re-login clears the board and asks for sign-in',()=>{
  assert.equal(tvAuthDecision('authentication-denied',true),'sign-in-prompt');
  assert.equal(tvAuthDecision('security-hide',false),'sign-in-prompt');
  assert.equal(tvAuthDecision(undefined,false),'sign-in-prompt');
});

test('a 503 waits before retrying',()=>{
  assert.equal(tvGatewayBackoff(0,()=>0),2_500);
  assert.equal(tvGatewayBackoff(0,()=>1),5_000);
  assert.equal(tvGatewayBackoff(1,()=>0),7_500);
  assert.equal(tvGatewayBackoff(2,()=>1),30_000);
  assert.equal(tvGatewayBackoff(3,()=>0.5),null);
  for(const status of [502,503,504]){
    const wait=tvSavedReadRetry({status,initial:false,retryUsed:false,hasField:false,recoveryBlocked:false,attempt:0,random:()=>0});
    assert.equal(wait,2_500);
    assert.ok(wait>0);
  }
  assert.equal(tvSavedReadRetry({status:503,initial:true,retryUsed:false,hasField:false,recoveryBlocked:false,attempt:0,random:()=>1}),5_000);
  assert.equal(tvSavedReadRetry({status:503,initial:false,retryUsed:false,hasField:true,recoveryBlocked:false,attempt:0,random:()=>0}),null);
  assert.equal(tvSavedReadRetry({status:546,initial:true,retryUsed:false,hasField:false,recoveryBlocked:false,attempt:0}),30_000);
  assert.equal(tvSavedReadRetry({status:546,initial:false,retryUsed:true,hasField:false,recoveryBlocked:false,attempt:0}),null);
  assert.equal(tvSavedReadRetry({status:503,transport:'rejected',initial:false,retryUsed:false,hasField:false,recoveryBlocked:false,attempt:0}),5_000);
});

test('network blips back off and then stop',()=>{
  assert.deepEqual([0,1,2,3].map(tvNetworkBackoff),[5_000,15_000,30_000,null]);
  assert.equal(isTvTransportFailure('rejected'),true);
  assert.equal(isTvTransportFailure('timeout'),true);
  assert.equal(isTvTransportFailure(546),false);
  assert.equal(isTvTransportFailure(503),false);
  assert.equal(isTvTransportFailure(null),false);
});

test('the TV watchdog reloads after 30 minutes',()=>{
  assert.equal(TV_WATCHDOG_MS,30*60*1000);
});

test('a silent re-login must produce a good read within 30 seconds',()=>{
  assert.equal(TV_RELOGIN_DEADLINE_MS,30_000);
  assert.ok(TV_RELOGIN_DEADLINE_MS>=15_000&&TV_RELOGIN_DEADLINE_MS<=30_000);
});

test('a render failure shows the sign-in prompt and no fleet data',()=>{
  assert.deepEqual(TvFleetErrorBoundary.getDerivedStateFromError(new Error('synthetic render failure')),{failed:true});
  const shown=renderToStaticMarkup(createElement(TvFleetErrorBoundary,null,'fleet row'));
  assert.equal(shown.includes(TV_SIGN_IN_PROMPT),false);
  assert.match(shown,/fleet row/);
  const prompt=renderToStaticMarkup(createElement('p',{className:'tv-fleet-warning',role:'alert'},TV_SIGN_IN_PROMPT));
  assert.match(prompt,/Sign in again to load fleet information/);
  assert.equal(prompt.includes('fleet row'),false);
});
