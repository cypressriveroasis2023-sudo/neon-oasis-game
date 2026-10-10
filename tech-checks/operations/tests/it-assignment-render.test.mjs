import assert from 'node:assert/strict';
import test from 'node:test';
import { readFileSync } from 'node:fs';
import { createRequire } from 'node:module';
import vm from 'node:vm';
import ts from 'typescript';
import * as React from 'react';
import { renderToStaticMarkup } from 'react-dom/server';
const require=createRequire(import.meta.url);
const source=readFileSync(new URL('../src/ITAssignmentQueue.tsx',import.meta.url),'utf8');
const compiled=ts.transpileModule(source,{compilerOptions:{module:ts.ModuleKind.CommonJS,target:ts.ScriptTarget.ES2022,jsx:ts.JsxEmit.ReactJSX}}).outputText;
const row=extra=>({assignmentId:'11111111-1111-4111-8111-111111111111',ticketNumber:'SYN-1001',site:'Synthetic north site',workType:'delivery',scheduledFor:'2026-10-10',scheduledTime:'08:30:00',status:'assigned',audience:'mine',equipment:[],unitSummary:'',...extra});
function render(snapshot=null,{loading=false,error='',search=''}={}){
 const values=[snapshot,loading,error,search];let index=0,reads=0;const exported={};
 const dependencies={react:{...React,useState:()=>[values[index++],()=>{}],useEffect:()=>{}},'react/jsx-runtime':require('react/jsx-runtime'),'./itMhelpBridge':{readITAssignments:()=>{reads++;throw new Error('Rendering must not read');}}};
 vm.runInNewContext(compiled,{exports:exported,require:name=>{assert.ok(Object.hasOwn(dependencies,name));return dependencies[name];},queueMicrotask});
 const html=renderToStaticMarkup(React.createElement(exported.default));return {html,reads};
}
test('queue text distinguishes own/department assignment and preserves exact recorded text as escaped content',()=>{
 const {html,reads}=render({generatedAt:'2026-10-10T12:00:00Z',items:[row({site:'Site <script> & gate',unitSummary:'Helios 001\nDo not choose an alternate.'}),row({assignmentId:'22222222-2222-4222-8222-222222222222',audience:'department',equipment:['2 × Synthetic Sniper']})]});
 assert.equal(reads,0);assert.equal((html.match(/<article /g)||[]).length,2);assert.match(html,/Your IT assignments and department queue/);assert.match(html,/Assigned to you/);assert.match(html,/Unclaimed IT department queue/);assert.match(html,/08:30 · as recorded/);assert.match(html,/Site &lt;script&gt; &amp; gate/);assert.match(html,/Helios 001\nDo not choose an alternate\./);assert.match(html,/2 × Synthetic Sniper/);
 assert.match(html,/Equipment not yet specified\. Review the original instructions in Tech Checks before selecting a unit\./);
 assert.match(html,/These records do not establish whether a ticket was imported/);assert.doesNotMatch(html,/<script>|No equipment|required equipment: none|data-wl-start|data-wl-claim/i);
 assert.equal((html.match(/<button /g)||[]).length,1,'only a read-only refresh control');
});
test('verified empty, failed, loading and filtered-out queues have distinct honest states',()=>{
 const snapshot={generatedAt:'2026-10-10T12:00:00Z',items:[row()]};
 assert.match(render(null,{loading:true}).html,/Loading your current IT assignments/);
 assert.match(render(null,{error:'IT assignments could not be loaded.'}).html,/role="alert"[^>]*>IT assignments could not be loaded/);
 assert.match(render({...snapshot,items:[]}).html,/No active IT assignments were returned/);
 const filtered=render(snapshot,{search:'no match'});assert.match(filtered.html,/No IT assignments match this search/);assert.doesNotMatch(filtered.html,/<article /);assert.equal(filtered.reads,0);
 assert.doesNotMatch(source,/\.rpc\(|\.post\(|\.insert\(|\.update\(|\.delete\(|localStorage|sessionStorage|openLegacy|dispatchEvent|\.click\(/);
});
