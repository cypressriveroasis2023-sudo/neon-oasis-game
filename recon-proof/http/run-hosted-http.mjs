/** Hosted-only real HTTP + actual PostgREST + real PostgreSQL proposal.
 * Merely importing this file never starts listeners. --validate is socket-free.
 */
import assert from 'node:assert/strict';
import {createServer} from 'node:http';
import {mkdir,writeFile} from 'node:fs/promises';
import {resolve,join} from 'node:path';
import {pathToFileURL,fileURLToPath} from 'node:url';
import {loadSources,createRestAdapter} from './runtime.mjs';
import {seedHttpFixture,matrix,nativeMatrix} from './matrix.mjs';

const json=(value,status=200)=>new Response(JSON.stringify(value),{status,headers:{'Content-Type':'application/json'}});
function argumentsFor(argv) {
 const args={};for(let i=0;i<argv.length;i++){
  if(['--validate','--include-native-replay','--public-only'].includes(argv[i]))args[argv[i].slice(2)]=true;
  else if(argv[i].startsWith('--')&&argv[i+1]&&!argv[i+1].startsWith('--'))args[argv[i].slice(2)]=argv[++i];
  else throw Error('Unknown or incomplete option '+argv[i]);
 }
 if(!args['source-root'])throw Error('Required --source-root');
 if(args['public-only']&&args.v33)throw Error('Public-only mode must not load private runtime captures.');
 if(!args['public-only']&&(!args.v33||!args['v33-sha256']))throw Error('Private mode requires --v33 and --v33-sha256');
 return args;
}

export async function createHostedContext({source,fixture,postgrest}) {
 let handlers;const requests=[];
 const server=createServer(async(req,res)=>{
  try{
   const buffers=[];for await(const chunk of req){buffers.push(chunk);if(buffers.reduce((n,b)=>n+b.length,0)>1024*1024)throw Error('HTTP body exceeds isolated fixture bound');}
   const host='http://127.0.0.1:'+server.address().port;
   const paths={'/functions/v1/reconeyez-webhook':'webhook','/functions/v1/reconeyez-connect':'connect','/functions/v1/camera-provider-reconcile':'reconcile','/functions/v1/saved-deployed-reconcile-v33':'v33'};
   const name=paths[new URL(req.url,host).pathname];
   const request=new Request(new URL(req.url,host),{method:req.method,headers:req.headers,...(!['GET','HEAD'].includes(req.method)?{body:Buffer.concat(buffers)}:{})});
   const response=name&&typeof handlers?.[name]==='function'?await handlers[name](request):json({error:'Unknown isolated fixture route'},404);
   const bytes=Buffer.from(await response.arrayBuffer());res.writeHead(response.status,Object.fromEntries(response.headers));res.end(bytes);
   requests.push({handler:name??null,method:req.method,status:response.status});
  }catch(error){res.writeHead(500,{'Content-Type':'application/json'});res.end(JSON.stringify({error:'Node handler wrapper failed',detail:error.message}));}
 });
 await new Promise((resolve,reject)=>{server.once('error',reject);server.listen(0,'127.0.0.1',resolve)});
 const origin='http://127.0.0.1:'+server.address().port;
 let adapter;try{adapter=createRestAdapter({fixture,postgrest,handlerOrigin:origin});handlers=source.makeHandlers(adapter);}catch(error){await new Promise(resolve=>server.close(resolve));throw error;}
 const paths={webhook:'reconeyez-webhook',connect:'reconeyez-connect',reconcile:'camera-provider-reconcile',v33:'saved-deployed-reconcile-v33'};
 return {source,fixture,postgrest,adapter,requests,evidence:{},async request(name,body,headers={},method='POST',defaultAuth=true){
  assert(paths[name]);const response=await fetch(origin+'/functions/v1/'+paths[name],{method,headers:{'Content-Type':'application/json',...(defaultAuth?{Authorization:'Bearer synthetic-owner'}:{}),...headers},
   ...(!['GET','HEAD'].includes(method)?{body:JSON.stringify(body)}:{}),signal:AbortSignal.timeout(60000)});
  return {status:response.status,body:await response.json()};
 },async close(){await new Promise((resolve,reject)=>server.close(error=>error?reject(error):resolve()));}};
}

export async function main(argv=process.argv.slice(2)) {
 const args=argumentsFor(argv);
 const selectedMatrix=matrix.filter(item=>!args['public-only']||!item.name.includes('saved-v33'));
 const omittedCases=matrix.filter(item=>!selectedMatrix.includes(item)).map(item=>({name:item.name,status:'NOT_RUN_PRIVATE_CAPTURE_REQUIRED'}));
 const source=await loadSources({sourceRoot:args['source-root'],v33Path:args.v33,v33Sha256:args['v33-sha256'],webhookPath:args.webhook});
 if(args.validate){
  const adapter={handlerOrigin:'http://127.0.0.1:1',trace:[],createClient(){throw Error('Validation cannot use database clients')},fetch(){throw Error('Validation cannot make network calls')}};
  const handlers=source.makeHandlers(adapter);assert.deepEqual(Object.keys(handlers).sort(),(args['public-only']?['connect','reconcile','webhook']:['connect','reconcile','v33','webhook']));
  console.log(JSON.stringify({stage:'socket-free-compile-and-source-identity',status:'PASS',sources:source.sources,cases:selectedMatrix.map(t=>t.name),omittedCases,limits:'No handler requests, sockets, real PostgreSQL, PostgREST, or Deno were executed.'},null,2));return;
 }
 if(process.env.GITHUB_ACTIONS!=='true'||process.env.RECON_ALLOW_HOSTED_HTTP!=='1')throw Error('Hosted HTTP requires GITHUB_ACTIONS=true and explicit RECON_ALLOW_HOSTED_HTTP=1. No listener was started.');
 for(const key of ['fixture-module','postgrest-module','output-dir'])if(!args[key])throw Error('Required --'+key);
 const {createHostedFixture}=await import(pathToFileURL(resolve(args['fixture-module'])).href);
 const {startPostgrest}=await import(pathToFileURL(resolve(args['postgrest-module'])).href);
 const output=resolve(args['output-dir']);await mkdir(output,{recursive:true});
 const evidence={schema_version:1,stage:'node-hosted-actual-handler-to-actual-postgrest-to-real-postgresql',started_at:new Date().toISOString(),node:process.version,sources:source.sources,omittedCases,
  limits:['Node-hosted source bodies and explicit import bindings, not Deno or deployed Supabase Edge runtime.',
   'Minimal HTTP adapter shaped like supabase-js, not a supabase-js package certification.',
   'Auth/profile, credential reads, provider inventory and unrelated MHelp scheduling are isolated synthetic boundaries.',
   'No provider, production database, real credentials, publication or deployment.',
   'PostgREST version is recorded per case; results do not silently certify another version.',
   'No HTTP test below establishes arbitrary multi-session SQL lock-order correctness. Parent PostgreSQL contention matrix is separate.',
   'Native 40001 transport/retry certification is the parent transport stage; optional native replay case explicitly labels its replay.'],cases:[]};
 let failed=0;
 for(const item of [...selectedMatrix,...(args['include-native-replay']?[nativeMatrix]:[])]) {
  let fixture,postgrest,ctx;const receipt={name:item.name,started_at:new Date().toISOString()};
  try{
   fixture=await createHostedFixture({name:'http-'+item.name});await seedHttpFixture(fixture);
   postgrest=await startPostgrest(fixture);receipt.postgrest_image=postgrest.image;
   ctx=await createHostedContext({source,fixture,postgrest});await item.run(ctx);receipt.status='PASS';receipt.evidence=ctx.evidence;
  }catch(error){failed++;receipt.status='FAIL';receipt.error=error.stack??String(error);}
  finally{
   if(ctx){receipt.http_requests=ctx.requests;receipt.trace=ctx.adapter.trace;await ctx.close().catch(error=>{receipt.cleanup_error=String(error);failed++})}
   if(postgrest)await postgrest.close().catch(error=>{receipt.postgrest_cleanup_error=String(error);failed++});
   if(fixture)await fixture.close().catch(error=>{receipt.fixture_cleanup_error=String(error);failed++});
  }
  receipt.finished_at=new Date().toISOString();evidence.cases.push(receipt);console.log(receipt.status+' '+item.name);
  await writeFile(join(output,'http-'+item.name+'.json'),JSON.stringify(receipt,null,2)+'\n');
 }
 evidence.finished_at=new Date().toISOString();evidence.failed=failed;evidence.passed=evidence.cases.filter(c=>c.status==='PASS').length;evidence.status=failed?'FAIL':'PASS';
 await writeFile(join(output,'http-summary.json'),JSON.stringify(evidence,null,2)+'\n');
 if(failed)throw Error(failed+' hosted HTTP case or cleanup failure(s). See '+join(output,'http-summary.json'));
 console.log('PASS '+evidence.passed+' Node-hosted handler / actual PostgREST groups. Deno/Edge remains unproved.');
}
if(process.argv[1]&&resolve(process.argv[1])===fileURLToPath(import.meta.url))main().catch(error=>{console.error(error.stack??String(error));process.exitCode=1});
