import test from 'node:test';
import assert from 'node:assert/strict';
import {readFileSync} from 'node:fs';
import {createHash} from 'node:crypto';
import {restoreTechCheckHost} from './approved-tech-checks-host-source.mjs';
const read=name=>readFileSync(new URL('../src/'+name,import.meta.url),'utf8');
const blob=text=>createHash('sha1').update('blob '+Buffer.byteLength(text)+'\0').update(text).digest('hex');
test('complete original Tech Check workspace reconstructs after the declared wrapper only',()=>{
 const original=read('TechChecksWorkspace.tsx').replace("import ApprovedCheckManagement from './ApprovedCheckManagement';\n",'').replace('<ApprovedCheckManagement>',"<details className='cos-approved-tool-group'><summary>Manage Tech Checks</summary>").replace('</ApprovedCheckManagement>','</details>');
 assert.equal(blob(original),'0baffbb1b1583ce06626a20638ea9759d027df75');
});
test('management never clones enables or invokes a check action',()=>{
 const text=read('ApprovedCheckManagement.tsx');assert.match(text,/\{children\}/);
 assert.doesNotMatch(text,/cloneElement|onClick|openLegacy|api\.|fetch|localStorage|sessionStorage|setInterval|setTimeout/);
});
test('Escape collapses the native disclosure and returns focus only when open',()=>{
 const text=read('ApprovedCheckManagement.tsx');assert.match(text,/event.key==='Escape'&&disclosure.current\?\.open/);
 assert.match(text,/event.preventDefault\(\);event.stopPropagation\(\)/);assert.match(text,/disclosure.current.open=false/);assert.match(text,/querySelector<HTMLElement>\('summary'\)\?\.focus\(\)/);
 assert.doesNotMatch(text,/<details[^>]*\sopen[\s=>]/);
});
test('the original management title and class are retained',()=>{
 const text=read('ApprovedCheckManagement.tsx');assert.match(text,/<summary>Manage Tech Checks<\/summary>/);assert.match(text,/className='cos-approved-tool-group cos-approved-check-management'/);
});
test('new styles are limited to the approved check hub, not technician forms',()=>{
 const text=read('approvedCheckManagement.css');assert.doesNotMatch(text,/\.(?:cos-fleet|camera|daily-board|tech-check-tv|login)|#view-(?:it|svc)|\bdisplay\s*:\s*none/);
 for(const block of text.matchAll(/([^{}]+)\{/g)){const selector=block[1].replace(/\/\*[\s\S]*?\*\//g,'').trim();if(selector&&!selector.startsWith('@'))assert.ok(/^#root(?:#root)? \.operations-shell\.cos-approved-shell \.cos-approved-checks/.test(selector),selector);}
});
test('phone tools stack and their original labels cannot be clipped by fixed heights',()=>{
 const text=read('approvedCheckManagement.css');assert.match(text,/min-height:88px !important/);assert.match(text,/min-height:52px !important/);assert.match(text,/grid-template-columns:minmax\(0,1fr\)/);assert.match(text,/overflow-wrap:anywhere/);assert.doesNotMatch(text,/(?:^|[;\n])\s*height:/);
});
test('original host input history sign-out and role assertions reconstruct exactly',()=>{
 const source=readFileSync(new URL('./tech-checks-navigation.browser.spec.mjs',import.meta.url),'utf8');
 assert.equal(blob(restoreTechCheckHost(source)),'e969fa255099463b0fc2547b2d7f7e8240b3ef2a');
});
