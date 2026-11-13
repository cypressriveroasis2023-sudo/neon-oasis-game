import {beforeFleetCountTrustSource} from './fleet-count-trust-source.mjs';
import test from 'node:test';
import assert from 'node:assert/strict';
import {readFileSync} from 'node:fs';
import {createHash} from 'node:crypto';
import {createRequire} from 'node:module';
import vm from 'node:vm';
import ts from 'typescript';
import React from 'react';
import {renderToStaticMarkup} from 'react-dom/server';
import {originalFleetViewMarkup} from './approved-fleet-view-source.mjs';
import {previousReviewedMainSource} from './approved-current-main-source.mjs';

const source=readFileSync(new URL('../src/ApprovedFleetViews.tsx',import.meta.url),'utf8');
const require=createRequire(import.meta.url),exports={};
vm.runInNewContext(ts.transpileModule(source,{compilerOptions:{jsx:ts.JsxEmit.ReactJSX,module:ts.ModuleKind.CommonJS,target:ts.ScriptTarget.ES2022}}).outputText,{exports,require:name=>name.endsWith('.css')?{}:require(name)});
const View=exports.default;
const labels=['Map','Fleet health','Camera status','Location verification','Needs setup','Data sources'];
function render(compact=true,selected=0,setup=true){
 const children=labels.map((label,index)=>index===4&&!setup?null:React.createElement('button',{key:label,'aria-current':index===selected?'page':undefined,onClick:()=>{}},label));
 return renderToStaticMarkup(React.createElement(View,{compact},children));
}
test('Owner only groups the original secondary buttons in a native closed disclosure',()=>{
 const html=render();assert.equal((html.match(/<button/g)||[]).length,6);
 const before=html.split('<details')[0];assert.match(before,/>Map<\/button>/);assert.match(before,/>Fleet health<\/button>/);assert.match(before,/>Camera status<\/button>/);
 for(const label of labels.slice(3))assert.equal(before.includes(label),false);
 assert.match(html,/<summary aria-label="More fleet tools"/);assert.doesNotMatch(html,/<details[^>]* open/);
});
test('restricted layout retains original direct buttons and no Owner disclosure',()=>{
 const html=render(false);assert.doesNotMatch(html,/<details|cos-approved-fleet-views/);
 for(const label of labels)assert.ok(html.includes(label));
});
test('Camera status on the bar never lights the tools summary',()=>{
 const html=render(true,2);assert.match(html,/<summary aria-label="More fleet tools">/);
});
test('a missing setup button stays absent; no permission is inferred by presentation',()=>{
 const html=render(true,0,false);assert.doesNotMatch(html,/Needs setup/);assert.equal((html.match(/<button/g)||[]).length,5);
});
test('the currently selected secondary view is visible in the collapsed summary',()=>{
 const html=render(true,5);assert.match(html,/<summary aria-label="More fleet tools" aria-current="page">/);assert.match(html,/<small>Data sources<\/small>/);
});
test('the reviewed Fleet baseline is preserved by the explicit runtime and wrapper reversals',()=>{
 const old=originalFleetViewMarkup(previousReviewedMainSource('FleetDashboard.tsx',beforeFleetCountTrustSource('FleetDashboard.tsx',readFileSync(new URL('../src/FleetDashboard.tsx',import.meta.url),'utf8'))));
 assert.equal(createHash('sha1').update('blob '+Buffer.byteLength(old)+'\0').update(old).digest('hex'),'8d711a97853b5f646d892f5552a792656623a9f8');
});
test('wrapper contains no data source, clock, link rewriting or new routing',()=>{
 assert.doesNotMatch(source,/\bfetch\s*\(|\bapi\.|setInterval|setTimeout|Date\.|location\.|history\.|localStorage|sessionStorage|cloneElement|\.props\.onClick\s*\(/);
 assert.match(source,/\{secondary\}/);assert.match(source,/!compact\?children/);
});
test('Fleet navigation CSS does not retheme status evidence or change existing map sizing',()=>{
 const css=readFileSync(new URL('../src/approvedFleetViews.css',import.meta.url),'utf8');
 assert.doesNotMatch(css,/cos-signal-|camera-status-|map-canvas|cos-fleet-unit-row|cos-fleet-stats/);
 assert.match(css,/min-height:48px/);assert.match(css,/white-space:normal/);
});
