import test from 'node:test';
import assert from 'node:assert/strict';
import {createElement} from 'react';
import {renderToStaticMarkup} from 'react-dom/server';
import {tvAuthDecision,tvNetworkBackoff,isTvNetworkStatus,TV_WATCHDOG_MS,TV_SIGN_IN_PROMPT,TvFleetErrorBoundary} from '../src/tvResilience.tsx';

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

test('network blips back off and then stop',()=>{
  assert.deepEqual([0,1,2,3].map(tvNetworkBackoff),[5_000,15_000,30_000,null]);
  assert.equal(isTvNetworkStatus(503),true);
  assert.equal(isTvNetworkStatus(401),false);
  assert.equal(isTvNetworkStatus(null),false);
});

test('the TV watchdog reloads after 30 minutes',()=>{
  assert.equal(TV_WATCHDOG_MS,30*60*1000);
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
