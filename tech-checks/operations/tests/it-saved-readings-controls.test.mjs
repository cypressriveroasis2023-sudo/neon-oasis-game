import test from 'node:test';
import assert from 'node:assert/strict';
import {readFileSync} from 'node:fs';
import {createRequire} from 'node:module';
import vm from 'node:vm';
import ts from 'typescript';
import React from 'react';
import {renderToStaticMarkup} from 'react-dom/server';
import {fieldProductFixture} from './fixtures/mhelp-field-health-fixtures.mjs';
import {originalItSavedReadingSource} from './it-saved-readings-source.mjs';
import {previousReviewedMainSource} from './approved-current-main-source.mjs';

const empty=()=>null;
function component(name,mocks={}){
 const url=new URL('../src/'+name,import.meta.url),require=createRequire(url),exports={};
 const source=ts.transpileModule(readFileSync(url,'utf8'),{compilerOptions:{jsx:ts.JsxEmit.ReactJSX,module:ts.ModuleKind.CommonJS,target:ts.ScriptTarget.ES2022}}).outputText;
 vm.runInNewContext(source,{exports,require:name=>name.endsWith('.css')?{}:Object.hasOwn(mocks,name)?mocks[name]:require(name)});
 return exports.default;
}
const Workspace=component('CameraHealthWorkspace.tsx',{
 './api':{api:{},openLegacy:()=>{}},
 './useCameraHealth':{useCameraHealth:()=>({data:null,fleet:null,error:'',loading:false,now:0,cameraHistory:new Map(),refresh:()=>{throw Error('Rendering must not initiate a read');}})},
 './HeliosPowerDetails':{default:empty},'./MhelpUnitRefresh':{default:empty},
 './CameraHealthOverview':{default:empty},'./UnitDiagnosticReport':{default:empty},
});
const CommandCenter=component('FleetCommandCenter.tsx',{'./FieldProductEvidence':{default:empty,productHealthLabel:()=>''}});

test('embedded and standalone camera workspaces omit IT reload without hiding diagnostics',()=>{
 for(const embedded of [false,true]){
  const it=renderToStaticMarkup(React.createElement(Workspace,{embedded,manualRefreshEnabled:false}));
  assert.doesNotMatch(it,/>Reload saved results<|>Reading saved results/);
  assert.match(it,/>Open Camera Health diagnostics<\/button>/);
  const owner=renderToStaticMarkup(React.createElement(Workspace,{embedded,manualRefreshEnabled:true}));
  assert.match(owner,/>Reload saved results<\/button>/);
 }
});
test('Data sources omit both manual refresh and fallback retry when no callback is allowed',()=>{
 const f=fieldProductFixture(),base={uploadInventory:f.upload,fieldHealth:null,healthReadSucceeded:false,rows:f.rows,addressMap:null,vrm:null,now:f.now,cameraCheckedAt:null,onOpen:()=>{},onShop:()=>{},onMap:()=>{}};
 for(const uploadInventory of [f.upload,null]){
  const it=renderToStaticMarkup(React.createElement(CommandCenter,{...base,uploadInventory}));
  assert.doesNotMatch(it,/>↻ Refresh saved evidence<|>Retry saved data</);
  const owner=renderToStaticMarkup(React.createElement(CommandCenter,{...base,uploadInventory,onRefresh:()=>{}}));
  assert.match(owner,uploadInventory?/>↻ Refresh saved evidence<\//:/>Retry saved data<\//);
 }
});
for(const name of ['App.tsx','FleetDashboard.tsx','it-daily-mode.browser.spec.mjs','mhelp-live-inventory.browser.spec.mjs'])test('IT follow-up reverses exactly to protected source: '+name,()=>{
 const directory=name.endsWith('.browser.spec.mjs')?'./':'../src/';
 originalItSavedReadingSource(name,previousReviewedMainSource(name,readFileSync(new URL(directory+name,import.meta.url),'utf8')));
});
