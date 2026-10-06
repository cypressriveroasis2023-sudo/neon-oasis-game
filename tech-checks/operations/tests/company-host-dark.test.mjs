import test from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { createHash } from 'node:crypto';

const html=readFileSync(new URL('../../index.html',import.meta.url),'utf8');
const css=readFileSync(new URL('../../company-host-theme.css',import.meta.url),'utf8');
test('dark host preserves script bodies and URLs except the reviewed queue cache version',()=>{
  assert.equal(html.split('production-assignments-host.js?v=operations-assigned-prep-20261006').length-1,1);
  assert.equal(html.split('cos-eye-branding.js?v=20261006b').length-1,1);
  const scripts=[...html.replace('production-assignments-host.js?v=operations-assigned-prep-20261006','production-assignments-host.js?v=operations-v100-phase2-20261004').replace('<link rel="stylesheet" href="./cos-eye-branding.css?v=20261006b">\n<script defer src="./cos-eye-branding.js?v=20261006b"></script>\n','').matchAll(/<script\b[^>]*>[\s\S]*?<\/script>/gi)].map(match=>match[0]);
  assert.equal(scripts.length,8);
  // Baseline main 9af5916e: includes full inline bodies and external module URLs.
  assert.equal(createHash('sha256').update(scripts.join('\n')).digest('hex'),'3794b35dcb29cf38aeacc107c543259c5b53ccde8e454e4b3aa294463319682d');
});
test('dark host selects dark browser chrome before blocking styles and preserves state ownership',()=>{
  assert.match(html,/<meta name="color-scheme" content="dark"/);
  assert.equal((html.match(/name="theme-color" content="#0B111C"/g)||[]).length,2);
  assert.ok(html.indexOf('name="color-scheme"')<html.indexOf('rel="stylesheet"'));
  assert.match(html,/company-host-theme\.css\?v=company-dark-20261006c/);
  assert.match(css,/color-scheme:dark/);
  assert.doesNotMatch(css,/(?:^|[;{])\s*(?:display|visibility|pointer-events)\s*:/m);
  assert.doesNotMatch(css,/filter\s*:\s*invert|@import|https?:/);
  for(const color of ['#0B111C','#111B2A','#172337','#E6EDF7','#A3B3CA','#2C3B51','#315FDF','#91B0FF','#15352D','#83D6AD','#3B2D18','#EDC27B','#3E202B','#F4A2AC','#617895'])assert.ok(css.includes(color),color);
});
