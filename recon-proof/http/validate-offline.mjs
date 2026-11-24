/** OPTIONAL socket-free smoke: in-memory REST SHIM + PGlite, NOT HTTP/PostgREST/PG proof.
 * Runs no listener and does not invoke hosted helpers. It catches harness mistakes only.
 */
import {resolve} from 'node:path';
import {pathToFileURL} from 'node:url';
import {writeFile} from 'node:fs/promises';
import {loadSources,createRestAdapter} from './runtime.mjs';
import {seedHttpFixture,matrix} from './matrix.mjs';
const [sourceRoot,webhookPath,v33Path,outputPath,filter]=process.argv.slice(2);
if(!sourceRoot||!webhookPath||!v33Path)throw Error('Expected sourceRoot webhookPath v33Path [outputPath]');
const {fixture}=await import(pathToFileURL(resolve(sourceRoot,'operations/tests/fixtures/recon-owned-metadata-v2.mjs')).href);
const source=await loadSources({sourceRoot,webhookPath,v33Path:v33Path==='-'?undefined:v33Path,v33Sha256:process.env.RECON_PRIVATE_V33_SHA256}),receipts=[];
const id=name=>{if(!/^[a-z_][a-z0-9_]*$/i.test(name))throw Error('Unexpected shim identifier '+name);return '"'+name+'"'};
const expression=key=>key==='payload->device_info->>type'?"payload->'device_info'->>'type'":id(key);
for(const item of matrix.filter(item=>(v33Path!=='-'||!item.name.includes('saved-v33'))&&(!filter||item.name.includes(filter)))) {
 let f,adapter;const receipt={name:item.name,transport:'in-memory REST shim',engine:'PGlite single session; not actual HTTP/PostgREST/PostgreSQL server'};
 try {
  f=await fixture({projector:true,compactor:true});await seedHttpFixture(f);let handlers;
  const networkFetch=async(input,init={})=>{
   const u=new URL(typeof input==='string'?input:input instanceof URL?input.href:input.url);
   if(u.port==='8081')return handlers.webhook(new Request(u,{method:init.method,headers:init.headers,body:init.body}));
   const name=u.pathname.slice(1),method=init.method??'GET',body=init.body?JSON.parse(init.body):null;
   try {
    if(name.startsWith('rpc/'))return new Response(JSON.stringify(await f.rpc(name.slice(4),body)),{status:200});
    const values=[],params=new URLSearchParams(u.search);let query,where=[];
    const bind=value=>{values.push(value);return '$'+values.length};
    for(const [k,v] of params)if(!['select','order','limit','on_conflict'].includes(k)) {
     if(v.startsWith('eq.'))where.push(expression(k)+'='+bind(v.slice(3)));
     else if(v.startsWith('in.'))where.push(expression(k)+' IN ('+v.slice(4,-1).split(',').map(x=>bind(x.replace(/^"|"$/g,''))).join(',')+')');
     else throw Error('Unexpected shim filter '+v);
    }
    const whereSql=where.length?' WHERE '+where.join(' AND '):'';
    if(method==='GET') {
     const columns=params.get('select')==='*'?'*':params.get('select').split(',').map(id).join(',');
     query='SELECT '+columns+' FROM public.'+id(name)+whereSql;
     if(params.has('order'))query+=' ORDER BY '+params.get('order').split(',').map(x=>{const[k,d]=x.split('.');return expression(k)+(d==='desc'?' DESC':' ASC')}).join(',');
     if(params.has('limit'))query+=' LIMIT '+Number(params.get('limit'));
    }else if(method==='POST') {
     const cols=Object.keys(body);query='INSERT INTO public.'+id(name)+'('+cols.map(id).join(',')+') VALUES('+cols.map(k=>bind(body[k])).join(',')+')';
     if(params.has('on_conflict'))query+=' ON CONFLICT('+id(params.get('on_conflict'))+') DO UPDATE SET '+cols.filter(k=>k!==params.get('on_conflict')).map(k=>id(k)+'=EXCLUDED.'+id(k)).join(',');
     query+=' RETURNING *';
    }else if(method==='PATCH')query='UPDATE public.'+id(name)+' SET '+Object.keys(body).map(k=>id(k)+'='+bind(body[k])).join(',')+whereSql+' RETURNING *';
    else throw Error('Unexpected shim method');
    const rows=await f.db.transaction(async tx=>{await tx.exec('SET LOCAL ROLE service_role');return (await tx.query(query,values)).rows});
    return new Response(JSON.stringify(rows),{status:200});
   }catch(error){return new Response(JSON.stringify({code:error.code??'SHIM_ERROR',message:error.message,details:null,hint:null}),{status:error.code==='PT409'?409:400});}
  };
  adapter=createRestAdapter({fixture:f,postgrest:{url:'http://127.0.0.1:8082',headers:{}},handlerOrigin:'http://127.0.0.1:8081',networkFetch,transportBoundary:'in_memory_rest_shim_not_postgrest'});
  handlers=source.makeHandlers(adapter);
  const context={source,fixture:f,adapter,evidence:{},request:async(name,payload,headers={},method='POST',defaultAuth=true)=>{
   const request=new Request('http://127.0.0.1:8081/functions/v1/'+({webhook:'reconeyez-webhook',connect:'reconeyez-connect',reconcile:'camera-provider-reconcile',v33:'saved-deployed-reconcile-v33'}[name]),{method,headers:{'Content-Type':'application/json',...(defaultAuth?{Authorization:'Bearer synthetic-owner'}:{}),...headers},...(!['GET','HEAD'].includes(method)?{body:JSON.stringify(payload)}:{})});
   const r=await handlers[name](request);return {status:r.status,body:await r.json()};
  }};
  await item.run(context);receipt.status='PASS';receipt.trace=adapter.trace;
 }catch(error){receipt.status='FAIL';receipt.error=error.stack??String(error)}
 finally{if(adapter)receipt.trace=adapter.trace;if(f)await f.close()}
 receipts.push(receipt);console.log(receipt.status+' socket-free smoke '+item.name+(receipt.error?'\n'+receipt.error:''));
}
if(outputPath)await writeFile(outputPath,JSON.stringify({stage:'socket-free-harness-smoke-only',actual_http:false,actual_postgrest:false,actual_postgresql_server:false,actual_deno:false,sources:source.sources,cases:receipts},null,2)+'\n');
if(receipts.some(r=>r.status==='FAIL'))process.exitCode=1;
