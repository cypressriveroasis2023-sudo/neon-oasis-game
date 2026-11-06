import test from 'node:test';import assert from 'node:assert/strict';import fs from 'node:fs';import vm from 'node:vm';import ts from 'typescript';import {build} from 'esbuild';import {webcrypto} from 'node:crypto';
import {prepare,expected} from './prepare-attribution-v133.mjs';
import {sha,cpuHelper,runtimeImport} from './prepare-product-tcp-preview-v129.mjs';
import {createScopePreview,readScopePreview} from '../src/productScopePreviewModel.ts';
const input=process.env.COS_ATTRIBUTION_V133_CAPTURE;
if(!input)throw Error('Exact v133 capture required; staging checks cannot skip');
const original=JSON.parse(fs.readFileSync(input,'utf8')),packet=await prepare(original),before=original.files[0].content,after=packet.payload.files[0].content;
const fixed=Date.now();class Clock extends Date{constructor(...args){super(...(args.length?args:[fixed]));}static now(){return fixed;}}
function boot(code,syntheticReply,oldRuntime=false){
 let served;const calls=[];const context=vm.createContext({console,Date:Clock,crypto:webcrypto,TextEncoder,TextDecoder,URL,URLSearchParams,Request,Response,Headers,AbortController,AbortSignal,structuredClone,setTimeout,clearTimeout,fetch:()=>{throw Error('Unexpected network');},Deno:{env:{get:name=>name==='SUPABASE_URL'?'https://platform.example':undefined},serve:fn=>{served=fn;}}});
 const jose='import{importPKCS8,SignJWT}from"jose";';assert.equal(code.split(jose).length,2);
 code=code.replace(jose,'const importPKCS8=()=>{throw Error("Unexpected signing")};const SignJWT=class {};');
 if(code.startsWith(runtimeImport))code=(oldRuntime?packet.oldRuntimeIife:packet.runtimeIife)+code.slice(runtimeImport.length);
 vm.runInContext(code,context);if(syntheticReply){context.syntheticReply=syntheticReply;vm.runInContext('CosProductTcpDisabledStage={...CosProductTcpDisabledStage,createProductPreviewHandler:options=>request=>syntheticReply(options,request)}',context);}assert.equal(typeof served,'function');return {context,served,factory:vm.runInContext('createOperationsHandler',context),calls};
}
// Reuse the exact existing synthetic auth/status source fixture, injecting the
// complete deployed-artifact handler instead of the repository handler import.
const fixturePath=new URL('../tests/mhelp-2027-connection-census.test.mjs',import.meta.url),text=fs.readFileSync(fixturePath,'utf8'),tree=ts.createSourceFile('fixture.mjs',text,ts.ScriptTarget.Latest,true,ts.ScriptKind.JS);
const selected=tree.statements.filter(n=>ts.isImportDeclaration(n)&&!n.getText(tree).includes("'node:")&&!n.getText(tree).includes('{createOperationsHandler}')||ts.isVariableStatement(n)&&n.declarationList.declarations.some(d=>['now','ranges','endpoint','devices','actors'].includes(d.name.getText(tree)))||ts.isFunctionDeclaration(n)&&['fixture','routeFixture'].includes(n.name?.text));
const fixtureCode=`const Date=class extends globalThis.Date{constructor(...args){super(...(args.length?args:[${fixed}]));}static now(){return ${fixed};}};\n`+selected.map(n=>n.getText(tree)).join('\n').replace("function routeFixture(role='owner',active=true,options={})","export function routeFixture(role='owner',active=true,createOperationsHandler,options={})");
const fixtureBundle=(await build({stdin:{contents:fixtureCode,resolveDir:new URL('.',fixturePath).pathname,loader:'ts'},bundle:true,format:'esm',platform:'node',write:false})).outputFiles[0].text;
const {routeFixture}=await import('data:text/javascript;base64,'+Buffer.from(fixtureBundle).toString('base64'));

test('v133 preservation, rollback and exact original-runtime rebuild',()=>{
 assert.equal(after.replace(packet.replacement,packet.original),before);assert.equal(cpuHelper(before),cpuHelper(after));assert.deepEqual(packet.rollback.files,original.files);assert.deepEqual(packet.payload.files[2],original.files[2]);assert.equal(packet.manifest.originalRuntimeRebuildExact,true);assert.match(after,/productTcpPreviewEnabled:true,productTcpProofEnabled:false,scopedProductTcpEnabled:false/);
});
test('complete artifact removes IP-only outcomes for Owner/IT; preserves denial and CORS',async()=>{
 for(const role of ['owner','it','service'])for(const active of [true,false]){
  const a=routeFixture(role,active,boot(before,undefined,true).factory),b=routeFixture(role,active,boot(after).factory),ra=await a.handler(a.request()),rb=await b.handler(b.request());
  assert.equal(rb.status,ra.status);assert.deepEqual([...rb.headers],[...ra.headers]);
  const old=await ra.json(),next=await rb.json();
  if(active&&role!=='service'){assert.equal(old.contract,'COS_EXACT_PRODUCT_CONNECTIONS_V1');assert.equal(next.contract,'COS_EXACT_PRODUCT_CONNECTIONS_V2');assert.deepEqual(next.items.map(i=>i.status),['unknown','unknown','unknown']);assert.ok(next.items.every(i=>i.checkedAt===null&&i.resourceId===null));}
  else{assert.deepEqual(next,old);assert.equal(b.calls.some(c=>c.url.includes('camera_devices')),false);}
 }
});
test('complete artifact source failures retain recognized status and bounded diagnostics',async()=>{
 for(const expression of ['new PrivateEvidenceError("SECRET",404)','new SheetsConnectionError("SECRET",401)','new UnitTrackerError("SECRET",400)','new OwnerIdentityError("SECRET",409)','Object.assign(new InhandPilotError("unavailable"),{status:429})','new MhelpImportError("SECRET",422)','new MhelpPartnerError("SECRET",403)','new MhelpTicketError("SECRET",502)','new Error("SECRET")']){
  const old=boot(before,undefined,true),next=boot(after),a=routeFixture('owner',true,old.factory,{testUploadError:vm.runInContext(expression,old.context)}),b=routeFixture('owner',true,next.factory,{testUploadError:vm.runInContext(expression,next.context)}),ra=await a.handler(a.request()),rb=await b.handler(b.request());assert.equal(rb.status,ra.status,expression);assert.deepEqual(await rb.json(),{error:'Saved connection source could not be verified.',diagnostic:{stage:'mhelp_census',code:'source_unavailable'}});
 }
});
test('preparation rejects version, file, configuration or entrypoint drift',async()=>{
 for(const mutate of [d=>d.version++,d=>d.files[0].content+=' ',d=>d.files[1].content+=' ',d=>d.files[2].content+=' ',d=>d.verify_jwt=true,d=>d.entrypoint_path='/wrong']){const d=structuredClone(original);mutate(d);await assert.rejects(()=>prepare(d));}
});
test('compiled runtime requires reviewed exact resource membership for conclusive TCP',async()=>{
 const runtime=await import('data:text/javascript;base64,'+Buffer.from(packet.payload.files[1].content).toString('base64'));
 const {productSource}=await import('../tests/fixtures/product-tcp-source.mjs');
 for(const linked of [true,false])for(const online of [true,false]){
  const f=await productSource({channels:1});if(!linked)f.source.upload.records[0].binding=null;
  const proof=await runtime.productResourceMembership(f.source,f.now,f.review),d=f.source.identitySources.devices[0];
  const device={deviceId:d.id,publicIp:d.public_ip,expectedPorts:d.expected_ports,connectionRevision:d.connection_revision,monitoringEnabled:true,portStatus:{80:{online,attempted:true},443:{online:false,attempted:true},_connection:{ip:d.public_ip,revision:d.connection_revision,checkedAt:new Date(f.now).toISOString(),status:online?'online':'offline',reachable:online}}};
  const result=runtime.buildExactProductConnections(proof.census,f.source.tracker,[device],f.now,proof.members);
  assert.equal(result.contract,'COS_EXACT_PRODUCT_CONNECTIONS_V2');assert.equal(result.items[0].status,linked?(online?'online':'offline'):'unknown');
 }
});
