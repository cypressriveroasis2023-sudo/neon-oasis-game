import test from 'node:test';
import assert from 'node:assert/strict';
import {readFileSync} from 'node:fs';
import {createHash} from 'node:crypto';
import {createRequire} from 'node:module';
import vm from 'node:vm';
import ts from 'typescript';
import React from 'react';
import {renderToStaticMarkup} from 'react-dom/server';
import {originalBoardActionsMarkup} from './approved-board-actions-source.mjs';
const source=readFileSync(new URL('../src/ApprovedBoardActions.tsx',import.meta.url),'utf8');
const require=createRequire(import.meta.url),exports={};
vm.runInNewContext(ts.transpileModule(source,{compilerOptions:{jsx:ts.JsxEmit.ReactJSX,module:ts.ModuleKind.CommonJS,target:ts.ScriptTarget.ES2022}}).outputText,{exports,require:name=>name.endsWith('.css')?{}:require(name)});
const View=exports.default;
const button=(name,disabled=false)=>React.createElement('button',{key:name,disabled,onClick:()=>{throw Error('Rendering must not call an action');}},name);
const render=children=>renderToStaticMarkup(React.createElement(View,null,children));
test('existing navigation remains visible before the initially closed management disclosure',()=>{
 const html=render([button('Schedule / Reassign'),button('Close Job'),button('Delete Job'),button('Open Jobs workspace')]);
 const before=html.split('<details')[0];assert.match(before,/Open Jobs workspace/);assert.doesNotMatch(before,/Schedule \/ Reassign|Close Job|Delete Job/);
 assert.doesNotMatch(html,/<details[^>]* open/);assert.match(html,/<summary>Manage this work<\/summary>/);
 assert.equal((html.match(/<button/g)||[]).length,4);
});
test('unavailable management actions are never invented for tasks or completed visits',()=>{
 const html=render([false,null,undefined,button('Open Owner Tasks workspace')]);
 assert.doesNotMatch(html,/<details|Manage this work|Delete|Schedule/);assert.equal((html.match(/<button/g)||[]).length,1);
});
test('disabled scheduling and original destructive-button styling survive grouping',()=>{
 const remove=React.createElement('button',{key:'remove',className:'danger',onClick:()=>{throw Error('No dispatch');}},'Delete Job');
 const html=render([button('Schedule / Reassign',true),remove,button('Open Jobs workspace')]);
 assert.match(html,/<button disabled="">Schedule \/ Reassign<\/button>/);assert.match(html,/<button class="danger">Delete Job<\/button>/);
 assert.doesNotMatch(html,/Close Job/);
});
test('component tolerates an empty action group without a false management control',()=>assert.doesNotMatch(render([]),/<details|<button/));
test('complete prior DailyBoard reconstructs exactly, including all eligibility and callbacks',()=>{
 const original=originalBoardActionsMarkup(readFileSync(new URL('../src/DailyBoard.tsx',import.meta.url),'utf8'));
 assert.equal(createHash('sha1').update('blob '+Buffer.byteLength(original)+'\0').update(original).digest('hex'),'0734601d3a4e5d0f18128c1cfb8197d1f50ee834');
 assert.match(original,/Open \{selected.kind==='job'\?'Jobs':'Owner Tasks'\} workspace<\/button><\/div>/);
});
test('presentation cannot fetch, persist, dispatch, enable, or clone an action',()=>{
 assert.doesNotMatch(source,/fetch\s*\(|\bapi\.|setInterval|setTimeout|localStorage|sessionStorage|dispatchEvent|cloneElement|\.props\.onClick|Date\.|location\.|history\./);
 assert.match(source,/\{workspace\}/);assert.match(source,/\{management\}/);assert.match(source,/event\.preventDefault\(\);event\.stopPropagation\(\)/);
});
test('new styles remain scoped and preserve danger and status colors',()=>{
 const css=readFileSync(new URL('../src/approvedBoardActions.css',import.meta.url),'utf8');
 assert.doesNotMatch(css,/cos-fleet|techcheck-tv|\.danger|\.camera-|operations-bottom-nav|daily-board-assign/);
 assert.match(css,/min-height:48px/);assert.match(css,/white-space:normal/);
});
