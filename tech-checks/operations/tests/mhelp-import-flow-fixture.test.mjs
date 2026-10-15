import assert from 'node:assert/strict';
import test from 'node:test';
import {readFileSync} from 'node:fs';
import {fileURLToPath} from 'node:url';
import vm from 'node:vm';
import ts from 'typescript';
import {build} from 'esbuild';
import {mhelpImportClient} from '../src/mhelpImportClient.ts';
import {readTicketDirectory} from '../src/ticketDirectoryData.ts';

// Execute the exact API module supplied to the browser fixture, using its real
// production session lease and synthetic get/post only. No browser or transport.
const root=fileURLToPath(new URL('../',import.meta.url)).replace(/\/$/,'');
const browserSource=readFileSync(new URL('./mhelp-import-flow.browser.spec.mjs',import.meta.url),'utf8');
const ast=ts.createSourceFile('mhelp-import-flow.browser.spec.mjs',browserSource,ts.ScriptTarget.Latest,true,ts.ScriptKind.JS);
let apiLoader,browserBundle;
function visit(node){
 if(ts.isVariableDeclaration(node)&&node.name.getText(ast)==='bundle')browserBundle=node.initializer.getText(ast);
 if(ts.isCallExpression(node)&&node.expression.getText(ast)==='build.onLoad'&&node.arguments[0]?.getText(ast).includes("namespace:'fixture-api'"))apiLoader=node.arguments[1].getText(ast);
 ts.forEachChild(node,visit);
}
visit(ast);assert.ok(apiLoader,'The browser fixture must have a single synthetic API loader');
const moduleSource=vm.runInNewContext('('+apiLoader+')()',{root,JSON});
const bundle=await build({stdin:{contents:moduleSource.contents,resolveDir:moduleSource.resolveDir,loader:moduleSource.loader},bundle:true,write:false,format:'cjs',platform:'browser'});
const panelSource=readFileSync(new URL('../src/MhelpTicketImport.tsx',import.meta.url),'utf8');
const actions=panelSource.slice(panelSource.indexOf('  const captureAction='),panelSource.indexOf('  const historyRead='));
const actionCode=ts.transpileModule(actions+'\nexports.captureAction=captureAction;exports.directory=directory;',{compilerOptions:{module:ts.ModuleKind.CommonJS,target:ts.ScriptTarget.ES2022}}).outputText;
const attachment={id:'10000000-0000-4000-8000-000000000001',organizationId:'20000000-0000-4000-8000-000000000001',sha256:'a'.repeat(64),byteLength:1,state:'staged',recoverable:true};
const deferred=()=>{let resolve;const promise=new Promise(done=>resolve=done);return {promise,resolve};};
function fixture(){
 const window=new EventTarget(),calls=[],updates=[];window.parent={};
 window.__api=async(path,method,body)=>{calls.push({path,method,body});return method==='GET'?{items:[]}:attachment;};
 const exports={},context={module:{exports},exports,window,location:{origin:'https://synthetic.example',search:''},Event,URLSearchParams,Error,fetch:()=>assert.fail('The fixture must never use real transport')};
 vm.createContext(context);vm.runInContext(bundle.outputFiles[0].text,context,{filename:'exact-mhelp-flow-fixture-api.js'});
 const api=context.module.exports.api;
 const valid={current:true},revision={current:0};Object.assign(context,{api,mounted:{current:true},importSessionValid:valid,revision,mhelpImportClient,readTicketDirectory,setCustomers:value=>updates.push(['customers',value]),setSites:value=>updates.push(['sites',value]),setDirectoryReady:value=>updates.push(['ready',value])});
 vm.runInContext(actionCode,context,{filename:'exact-MhelpTicketImport-capture-and-directory.js'});
 const event=(type,extra={})=>window.dispatchEvent(Object.assign(new Event(type),extra));
 const hide=(origin=context.location.origin,source=window.parent)=>event('message',{origin,source,data:{type:'COS_OPERATIONS_HIDE_PRIVATE_EVIDENCE'}});
 return {api,calls,updates,valid,revision,event,hide,captureAction:exports.captureAction,directory:exports.directory};
}

test('the complete browser fixture bundle resolves the real session lease through its synthetic API namespace',async()=>{
 assert.ok(browserBundle);const full=await new Function('build','root','return (async()=>'+browserBundle+')();')(build,root);
 const js=full.outputFiles.find(file=>file.path.endsWith('.js'));assert.ok(js);assert.match(js.text,/captureSession/);assert.ok(full.outputFiles.some(file=>file.path.endsWith('.css')));
});

test('the flow fixture supplies the real lease contract needed to load the customer/site directory',async()=>{
 const f=fixture();assert.equal(typeof f.api.captureSession,'function');await f.directory();
 assert.deepEqual(f.calls.map(({path,method})=>({path,method})),[{path:'/api/customers',method:'GET'},{path:'/api/sites',method:'GET'}]);
 assert.deepEqual(f.updates,[['customers',[]],['sites',[]],['ready',true]]);
});
for(const boundary of ['invalidation','trusted-hide','pagehide'])test('the exact flow fixture lease blocks deferred import bytes after '+boundary,async()=>{
 const f=fixture(),bytes=deferred(),action=f.captureAction();assert.equal(action.current(),true);
 const pending=action.client.stage(attachment.id,{}, {arrayBuffer:()=>bytes.promise});
 if(boundary==='trusted-hide')f.hide();else f.event(boundary==='pagehide'?'pagehide':'cos-private-data-invalidated');
 assert.equal(action.current(),false);bytes.resolve(new Uint8Array([1]).buffer);await assert.rejects(pending,/session changed/);assert.deepEqual(f.calls,[]);
});
test('healthy hide permits a new explicit import action, but hard invalidation stays blocked by the component',async()=>{
 const f=fixture(),old=f.captureAction();f.hide();f.revision.current++;assert.equal(old.current(),false);
 const fresh=f.captureAction();assert.equal(fresh.current(),true);await fresh.client.stage(attachment.id,{}, {arrayBuffer:async()=>new Uint8Array([1]).buffer});assert.equal(f.calls.length,1);
 f.valid.current=false;f.event('cos-private-data-invalidated');const blocked=f.captureAction();assert.equal(blocked.current(),false);
 await assert.rejects(blocked.client.stage(attachment.id,{}, {arrayBuffer:async()=>new Uint8Array([1]).buffer}),/session changed/);assert.equal(f.calls.length,1);
});
test('untrusted or sibling hide messages cannot invalidate the fixture lease',()=>{
 const f=fixture(),lease=f.api.captureSession();f.hide('https://untrusted.example');f.hide('https://synthetic.example',{});assert.equal(lease(),true);assert.deepEqual(f.calls,[]);
});
