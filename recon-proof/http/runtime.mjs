/** Actual source bodies hosted by Node, NOT Deno/Supabase Edge certification. */
import {readFile} from 'node:fs/promises';
import {createRequire} from 'node:module';
import {createHash} from 'node:crypto';
import {resolve,join} from 'node:path';
import {pathToFileURL} from 'node:url';

export const gid=n=>'01'+n.toString(16).toUpperCase().padStart(4,'0')+'0000000000';
export const old='2026-01-01T01:02:03.000Z';
export const rawInventory=()=>[
 {guid:gid(1),type:'bridge_4g',area:'Synthetic Field',name:'Synthetic bridge'},
 {guid:gid(2),type:'detector_hdr_xrl',area:'Synthetic Field',name:'Synthetic detector',description:'Synthetic description'},
 {guid:gid(3),type:'detector_hdr_xrl',area:'Synthetic Field',name:'Synthetic detector two',description:'Synthetic description'}
];
export const sha256=value=>createHash('sha256').update(value).digest('hex');

export async function loadSources({sourceRoot,webhookPath,v33Path,v33Sha256}) {
 sourceRoot=resolve(sourceRoot);
 const require=createRequire(join(sourceRoot,'operations/package.json'));
 const ts=require('typescript');
 const paths={connect:join(sourceRoot,'supabase/functions/reconeyez-connect/index.ts'),
  reconcile:join(sourceRoot,'supabase/functions/camera-provider-reconcile/index.ts'),
  webhook:webhookPath?resolve(webhookPath):join(sourceRoot,'supabase/functions/reconeyez-webhook/index.ts'),
  ...(v33Path?{v33:resolve(v33Path)}:{})};
 if(v33Path&&!/^[a-f0-9]{64}$/.test(v33Sha256??''))throw Error('Private v33 source requires its separately supplied expected SHA256.');
 const compiled={},sources={};
 for(const [name,path] of Object.entries(paths)) {
  const bytes=await readFile(path),text=bytes.toString('utf8');
  if(name==='v33'&&sha256(bytes)!==v33Sha256)throw Error('Saved deployed v33 bytes do not match the retained SHA256.');
  const ast=ts.createSourceFile(path,text,ts.ScriptTarget.Latest,true,ts.ScriptKind.TS);
  const imports=ast.statements.filter(ts.isImportDeclaration);
  // Remove import declarations only, retaining every actual handler/function body.
  let body=text;for(const statement of imports.slice().reverse())body=body.slice(0,statement.pos)+body.slice(statement.end);
  const output=ts.transpileModule(body,{fileName:path,reportDiagnostics:true,compilerOptions:{target:ts.ScriptTarget.ES2022,module:ts.ModuleKind.None}});
  const errors=(output.diagnostics??[]).filter(d=>d.category===ts.DiagnosticCategory.Error);
  if(errors.length)throw Error(ts.formatDiagnosticsWithColorAndContext(errors,{getCurrentDirectory:()=>sourceRoot,getCanonicalFileName:x=>x,getNewLine:()=> '\n'}));
  compiled[name]=output.outputText;sources[name]={path,sha256:sha256(bytes),bytes:bytes.length,imports:imports.map(i=>i.moduleSpecifier.text)};
 }
 const importShared=name=>import(pathToFileURL(join(sourceRoot,'supabase/functions/_shared',name)).href);
 const owned=await importShared('reconOwnedMetadataV2.ts');
 const projector=await importShared('reconProviderInventory.ts');
 const archive=await importShared('reconEventArchive.ts');
 const inventory=await import(pathToFileURL(join(sourceRoot,'supabase/functions/reconeyez-connect/inventorySync.ts')).href);
 for(const file of ['reconOwnedMetadataV2.ts','reconProviderInventory.ts','reconEventArchive.ts']) {
  const bytes=await readFile(join(sourceRoot,'supabase/functions/_shared',file));sources[file]={sha256:sha256(bytes),bytes:bytes.length};
 }
 for(const name of ['reconeyez-owned-metadata-v2.sql','reconeyez-receipt-v2.sql','reconeyez-event-ordering.sql','reconeyez-inventory-sync.sql']) {
  const bytes=await readFile(join(sourceRoot,'database-maintenance',name));sources[name]={sha256:sha256(bytes),bytes:bytes.length};
 }
 const inventoryBytes=await readFile(join(sourceRoot,'supabase/functions/reconeyez-connect/inventorySync.ts'));
 sources.inventorySync={sha256:sha256(inventoryBytes),bytes:inventoryBytes.length};
 return {sources,owned,projector,inventory,makeHandlers(adapter) {
  const handlers={};
  for(const [name,body] of Object.entries(compiled)) {
   const forbidden=()=>{throw Error('Non-Recon dependency is outside this isolated harness.');};
   const bindings={...owned,...projector,...archive,...inventory,
    createClient:adapter.createClient,fetch:adapter.fetch,
    crypto:globalThis.crypto,
    Deno:{env:{get:key=>({SUPABASE_URL:adapter.handlerOrigin,SUPABASE_ANON_KEY:'synthetic-anon',SUPABASE_SERVICE_ROLE_KEY:'synthetic-service'}[key])},
     serve:handler=>{handlers[name]=handler;},connect:forbidden},
    // The unrelated background intake is outside this Recon proof. Record its exclusion.
    scheduleCameraMhelpIntake:()=>adapter.trace.push({boundary:'excluded_unrelated_mhelp_scheduler'}),
    EdgeRuntime:{waitUntil:forbidden},resolveStarResources:forbidden,starResourceStatus:forbidden,unmappedResourceDiagnostics:forbidden,
    console:{log(){},warn(){},error(){}}};
   new Function(...Object.keys(bindings),body)(...Object.values(bindings));
   if(typeof handlers[name]!=='function')throw Error('Missing Deno.serve capture for '+name);
  }
  return handlers;
 }};
}

const ok=data=>({data,error:null});
const tokenUser=token=>{
 const value=String(token??'').replace(/^Bearer\s+/i,'');
 const role={ 'synthetic-owner':'owner','synthetic-it':'it','synthetic-field':'field','synthetic-inactive':'owner'}[value];
 return role?{id:value,role,active:value!=='synthetic-inactive'}:null;
};
const clone=value=>JSON.parse(JSON.stringify(value));

/** Minimal supabase-js-shaped transport. Its requests go to actual PostgREST.
 * It does not certify supabase-js behavior; it deliberately has no external fallback.
 */
export function createRestAdapter({fixture,postgrest,handlerOrigin,behavior={},networkFetch=globalThis.fetch,transportBoundary='actual_postgrest'}) {
 const trace=[];
 const gateway=new URL(postgrest.url);
 if(!['127.0.0.1','localhost','[::1]'].includes(gateway.hostname))throw Error('Only an isolated loopback PostgREST is permitted.');
 const headers={...postgrest.headers};
 const adapter={trace,behavior,handlerOrigin,transportBoundary,createClient:null,fetch:null};
 const invoke=async(path,{method='GET',body,signal}={})=>{
  const response=await networkFetch(new URL(path,gateway.href.endsWith('/')?gateway.href:gateway.href+'/'),{
   method,headers:{...headers,'Content-Type':'application/json',Accept:'application/json',Prefer:'return=representation'},
   ...(body!==undefined?{body:JSON.stringify(body)}:{}),signal});
  const raw=await response.text();let value;try{value=JSON.parse(raw)}catch{value=null}
  trace.push({boundary:transportBoundary,path,method,status:response.status,response:value});
  return response.ok?ok(value):{data:null,error:value??{code:'HTTP_'+response.status,message:'Non-JSON SQL gateway error'}};
 };
 adapter.fetch=async(input,init={})=>{
  const url=new URL(typeof input==='string'?input:input instanceof URL?input.href:input.url);
  if(url.origin===new URL(handlerOrigin).origin&&url.pathname==='/functions/v1/reconeyez-webhook')return networkFetch(input,init);
  if(url.protocol==='https:'&&['synthetic.invalid','na.reconeyez.com'].includes(url.hostname)&&url.port==='9028'&&url.pathname==='/control/v1/get_device_list') {
   trace.push({boundary:'synthetic_provider',method:init.method??'GET'});
   if(behavior.provider)return behavior.provider({url,init,fixture,trace});
   return new Response(JSON.stringify(behavior.inventory??rawInventory()),{status:behavior.providerStatus??200,headers:{'Content-Type':'application/json'}});
  }
  // Metadata uses the client's injected fetch with its real AbortSignal.
  if(url.origin===gateway.origin)return networkFetch(input,init);
  throw Error('External network is forbidden by this harness: '+url.origin);
 };
 adapter.createClient=(_url,_key,options={})=>{
  const clientAuth=options.global?.headers?.Authorization;
  const customFetch=options.global?.fetch;
  const request=customFetch?async(path,init={})=>{
   const url=new URL(path,gateway.href.endsWith('/')?gateway.href:gateway.href+'/');
   const response=await customFetch(url.href,{method:init.method??'GET',headers:{...headers,'Content-Type':'application/json',Accept:'application/json',Prefer:'return=representation'},...(init.body!==undefined?{body:JSON.stringify(init.body)}:{})});
   const raw=await response.text();let value;try{value=JSON.parse(raw)}catch{value=null}
   trace.push({boundary:transportBoundary,path,method:init.method??'GET',status:response.status,response:value});
   return response.ok?ok(value):{data:null,error:value??{code:'HTTP_'+response.status,message:'Non-JSON SQL gateway error'}};
  }:invoke;
  const client={auth:{getUser:async token=>{const user=tokenUser(token??clientAuth);trace.push({boundary:'synthetic_auth',accepted:Boolean(user)});return ok({user:user?{id:user.id}:null})}},
   async rpc(name,args={}) {
    trace.push({rpc:name,args:clone(args)});
    if(name==='get_reconeyez_integration_secrets')return ok({server_host:'synthetic.invalid',server_port:9028,username:'synthetic-username',password:'synthetic-password',webhook_secret:'synthetic-webhook-token'});
    if(name==='verify_camera_health_cron_secret')return ok(args.candidate==='synthetic-cron-token');
    if(behavior.beforeRpc){const reply=await behavior.beforeRpc({name,args,fixture,trace});if(reply)return reply;}
    const result=await request('rpc/'+name,{method:'POST',body:args});
    if(behavior.afterRpc)return await behavior.afterRpc({name,args,result,fixture,trace})??result;
    return result;
   },
   from(table) {
    if(!['profiles','camera_devices','equipment_master','camera_integrations','camera_integration_events'].includes(table))throw Error('Unexpected table '+table);
    const spec={table,op:'select',columns:'*',filters:[],orders:[],limit:null,single:false};let cached;
    const execute=async()=>{
     trace.push({table,op:spec.op,filters:clone(spec.filters),...(spec.body?{body:clone(spec.body)}:{})});
     if(table==='profiles'){
      const user=tokenUser(spec.filters.find(f=>f.key==='user_id')?.value);
      return ok(user?{user_id:user.id,role:user.role,active:user.active}:null);
     }
     if(behavior.beforeTable){const reply=await behavior.beforeTable({spec:clone(spec),fixture,trace});if(reply)return reply;}
     const query=new URLSearchParams();query.set('select',spec.columns);
     for(const f of spec.filters)query.append(f.key,f.type==='in'?'in.('+f.value.map(v=>'"'+String(v).replaceAll('"','\\"')+'"').join(',')+')':'eq.'+String(f.value));
     if(spec.orders.length)query.set('order',spec.orders.map(o=>o.key+'.'+(o.ascending?'asc':'desc')).join(','));
     if(spec.limit!==null)query.set('limit',String(spec.limit));
     if(spec.op==='upsert')query.set('on_conflict',spec.onConflict);
     // Upsert needs the real PostgREST conflict-resolution preference.
     let result;
     if(spec.op==='upsert') {
      const response=await networkFetch(new URL(table+'?'+query,gateway.href.endsWith('/')?gateway.href:gateway.href+'/'),{method:'POST',headers:{...headers,'Content-Type':'application/json',Accept:'application/json',Prefer:'return=representation,resolution=merge-duplicates'},body:JSON.stringify(spec.body)});
      const value=await response.json();trace.push({boundary:transportBoundary,path:table,method:'POST',status:response.status,response:value});result=response.ok?ok(value):{data:null,error:value};
     }else result=await request(table+'?'+query,{method:spec.op==='insert'?'POST':spec.op==='update'?'PATCH':'GET',...(spec.body?{body:spec.body}:{})});
     if(!result.error&&spec.single){const rows=result.data;if(!Array.isArray(rows)||rows.length>1)result={data:null,error:{code:'HARNESS_SINGLE',message:'Expected at most one row'}};else result=ok(rows[0]??null);}
     if(behavior.afterTable)return await behavior.afterTable({spec:clone(spec),result,fixture,trace})??result;
     return result;
    };
    const once=()=>cached??=(execute());
    const builder={select(columns='*'){spec.columns=columns;return builder},eq(key,value){spec.filters.push({key,value,type:'eq'});return builder},in(key,value){spec.filters.push({key,value,type:'in'});return builder},order(key,{ascending=true}={}){spec.orders.push({key,ascending});return builder},limit(value){spec.limit=value;return builder},
     insert(body){spec.op='insert';spec.body=body;return builder},update(body){spec.op='update';spec.body=body;return builder},upsert(body,{onConflict}={}){spec.op='upsert';spec.body=body;spec.onConflict=onConflict;return builder},
     maybeSingle(){spec.single=true;return once()},single(){spec.single=true;return once()},then(resolve,reject){return once().then(resolve,reject)}};
    return builder;
   },storage:new Proxy({}, {get(){throw Error('Binary Storage is outside this HTTP matrix; actual archive helper receives nonbinary inputs only.')}})};
  return client;
 };
 return adapter;
}
