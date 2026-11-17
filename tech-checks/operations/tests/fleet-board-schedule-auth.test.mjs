// Offline proof of the scheduled produce admission. No live session, database
// deployment, or secret value from the environment is used.
import test from 'node:test';
import assert from 'node:assert/strict';
import {readFileSync} from 'node:fs';
import {createHash,webcrypto} from 'node:crypto';
import {resolve,join} from 'node:path';
import {fileURLToPath} from 'node:url';
import vm from 'node:vm';
import {buildSync} from 'esbuild';
import {PGlite} from '@electric-sql/pglite';
import {preparePayload,liveFileProblems} from '../../../.github/scripts/deploy-recorded-function.mjs';

const root=resolve(fileURLToPath(new URL('../../../',import.meta.url)));
const patch=JSON.parse(readFileSync(join(root,'.github/function-patches/cos-fleet-board-producer/schedule-produce-secret.json'),'utf8'));
const rollback=JSON.parse(readFileSync(join(root,'.github/function-patches/cos-fleet-board-producer/rollback-schedule-produce-secret.json'),'utf8'));
const gate=JSON.parse(readFileSync(join(root,'.github/function-patches/cos-fleet-board-producer/restrict-to-produce-v9.json'),'utf8'));
const read=name=>readFileSync(join(root,patch.sourceDir,name));
const prepared=preparePayload(patch,read);
const entry=prepared.find(file=>file.recordName==='index.ts').content.toString('utf8');
const serve=prepared.find(file=>file.recordName==='serve.ts').content.toString('utf8');
const liveEntry=read('index.ts').toString('utf8');
const importUrl='https://raw.githubusercontent.com/cypressriveroasis2023-sudo/neon-oasis-game/b5b188229346182d9a4e29da42415a1b9d3b9d53/tech-checks/docs/vision-native-preview-20261107/source/serve.ts';
const SECRET='synthetic-produce-secret-value-32b';
const runId='11111111-1111-4111-8111-111111111111';
const sha=value=>createHash('sha256').update(value).digest('hex');

test('the secret patch builds on the PR 425 producer entry and can roll back to it',()=>{
  assert.equal(patch.requireLiveFiles['cos-fleet-board-producer/index.ts'],gate.expectedAfter['index.ts']);
  assert.equal(patch.requireLiveBeforeDeploy.version,undefined);
  assert.equal(patch.verifyJwt,false);
  assert.equal(liveEntry.includes(importUrl),true);
  assert.equal(entry.includes('await import("./serve.ts");'),true);
  assert.equal(entry.includes('PRODUCER_BODY_LIMIT=65536'),true);
  assert.equal(entry.includes('COS_FLEET_BOARD_PRODUCE_SECRET'),true);
  assert.equal(entry.includes(SECRET),false);
  assert.equal(serve.includes('fleetProduceOnly'),true);
  assert.equal(serve.includes('Exact saved board batch required'),true);
  const rolled=preparePayload(rollback,name=>readFileSync(join(root,rollback.sourceDir,name)));
  assert.equal(rollback.edits.length,0);
  assert.equal(rolled.find(file=>file.recordName==='index.ts').content.toString('utf8'),liveEntry);
  assert.deepEqual(liveFileProblems(
    [{name:'cos-fleet-board-producer/index.ts',content:liveEntry}],
    patch.requireLiveFiles
  ),[]);
  assert.equal(liveFileProblems(
    [{name:'index.ts',content:'different'}],
    {'cos-fleet-board-producer/index.ts':gate.expectedAfter['index.ts']}
  ).length,1);
});

function boot(secret=SECRET){
  const source=entry.replace(
    'await import("./serve.ts");',
    'Deno.serve(async request=>new Response(JSON.stringify({served:true,admitted:request.headers.get("X-COS-Fleet-Produce-Admitted"),authorization:request.headers.get("Authorization")||""}),{status:200,headers:{"Content-Type":"application/json"}}));'
  );
  const seen=[];
  const Deno={
    serve(handler){seen.push(handler);return handler;},
    env:{get(name){return name==='COS_FLEET_BOARD_PRODUCE_SECRET'?secret:undefined;}}
  };
  vm.runInNewContext(source,{Deno,URL,Request,Response,Headers,JSON,TextDecoder,TextEncoder,Uint8Array,crypto:webcrypto},{filename:'cos-fleet-board-producer/index.ts'});
  assert.equal(seen.length,1);
  return seen[0];
}

async function call(restricted,path,{secret,token,method='POST',body,raw}={}){
  const headers={'Content-Type':'application/json'};
  if(secret!==undefined)headers['X-COS-Fleet-Board-Produce']=secret;
  if(token)headers.Authorization='Bearer '+token;
  const response=await restricted(new Request('https://platform.example/functions/v1/cos-fleet-board-producer',{
    method,
    headers,
    body:method==='GET'||method==='OPTIONS'?undefined:raw??JSON.stringify(body??{path,method:'POST',body:{run:runId}})
  }));
  let parsed=null;try{parsed=await response.json();}catch{parsed=null;}
  return {status:response.status,body:parsed};
}

test('a matching secret is admitted only to produce and still reaches the handler',async()=>{
  const restricted=boot();
  const ok=await call(restricted,'/api/fleet-saved-board/produce',{secret:SECRET});
  assert.equal(ok.status,200);
  assert.equal(ok.body.served,true);
  assert.equal(ok.body.admitted,'1');
  assert.equal(ok.body.authorization,'');
  const direct=await restricted(new Request('https://platform.example/functions/v1/cos-fleet-board-producer/api/fleet-saved-board/produce',{
    method:'POST',
    headers:{'Content-Type':'application/json','X-COS-Fleet-Board-Produce':SECRET},
    body:JSON.stringify({run:runId})
  }));
  assert.equal(direct.status,200);
  assert.equal((await direct.json()).admitted,'1');
});

test('a missing or wrong secret with no user token is 401 and does not reach the handler',async()=>{
  const restricted=boot();
  for(const secret of [undefined,'wrong-secret-value-not-the-real-one','']){
    const result=await call(restricted,'/api/fleet-saved-board/produce',{secret});
    assert.equal(result.status,401,JSON.stringify(result.body));
    assert.deepEqual(result.body,{error:'Sign in to Tech Check to continue.'});
    assert.equal(JSON.stringify(result.body).includes(SECRET),false);
  }
  const unset=boot('');
  const missing=await call(unset,'/api/fleet-saved-board/produce',{secret:SECRET});
  assert.equal(missing.status,401);
});

test('a user token keeps the current path and a service or anonymous caller is not admitted by the secret',async()=>{
  const restricted=boot();
  const user=await call(restricted,'/api/fleet-saved-board/produce',{token:'synthetic-token',secret:'wrong-secret-value-not-the-real-one'});
  assert.equal(user.status,200);
  assert.equal(user.body.admitted,null);
  assert.equal(user.body.authorization,'Bearer synthetic-token');
  const anon=await call(restricted,'/api/fleet-saved-board/produce',{});
  assert.equal(anon.status,401);
});

test('the secret is not honored on any other route, and a huge body is refused before admission',async()=>{
  const restricted=boot();
  for(const path of ['/api/jobs','/api/session','/api/fleet-saved-board/refresh','/api/fleet-saved-board']){
    const result=await call(restricted,path,{secret:SECRET});
    assert.equal(result.status,404,path);
    assert.deepEqual(result.body,{error:'COS endpoint not found.'});
  }
  const bulky=await call(restricted,'/api/fleet-saved-board/produce',{secret:SECRET,raw:JSON.stringify({path:'/api/fleet-saved-board/produce',method:'POST',body:{run:runId,pad:'x'.repeat(70000)}})});
  assert.equal(bulky.status,413);
  assert.deepEqual(bulky.body,{error:'Request body is too large.'});
  const options=await restricted(new Request('https://platform.example/functions/v1/cos-fleet-board-producer',{method:'OPTIONS'}));
  assert.equal(options.status,200);
});

const owner={id:'e4abc521-1ef3-45a6-9829-b87faff78210',actor:'3f073784-96e7-43d8-b9e0-33ab31c3c8b1',department:'owner',role:'owner',name:'Synthetic Owner'};
const service={id:'78e54fbd-c2db-4d18-8e3d-a9740adcf285',actor:'7b3b8561-5dc1-46ff-8cdd-129ce2a2afb8',department:'service',role:'service_technician',name:'Abel Cervantes'};
const org='ece6d2a2-fd19-4cc7-b56a-2fa004a6d8f5';

function bootHandler(){
  const code=buildSync({stdin:{contents:serve+'\nglobalThis.__nativeFactory=createOperationsHandler;',resolveDir:join(root,'tech-checks/docs/vision-native-preview-20261107/source'),sourcefile:'serve.ts',loader:'ts'},bundle:true,platform:'node',format:'iife',target:'es2022',external:['jose'],write:false,logLevel:'silent'}).outputFiles[0].text;
  const calls=[],tasks=[];
  const json=(body,status=200)=>new Response(JSON.stringify(body),{status,headers:{'Content-Type':'application/json'}});
  const deny=()=>{throw Error('signing is forbidden in this offline proof');};
  let handler;
  const context=vm.createContext({console,crypto:webcrypto,structuredClone,TextEncoder,TextDecoder,URL,URLSearchParams,Request,Response,Headers,AbortController,AbortSignal,setTimeout,clearTimeout,
    fetch:async(url,init={})=>{
      const body=init.body?JSON.parse(init.body):null;
      if(String(url).includes('/functions/v1/')){
        calls.push({kind:'hop',authorization:init.headers?.Authorization||'',path:body?.path||''});
        return json({error:'Sign in to Tech Check to continue.'},401);
      }
      throw Error('Unexpected network '+url);
    },
    require:name=>{assert.equal(name,'jose');return {importPKCS8:deny,SignJWT:class{constructor(){deny();}}};},
    Deno:{env:{get:name=>name==='COS_FLEET_BOARD_PRODUCE_SECRET'?SECRET:name==='SUPABASE_URL'?'https://platform.example':undefined},serve(){}},
    EdgeRuntime:{waitUntil:task=>tasks.push(task)}
  });
  vm.runInContext(code,context,{timeout:15000});
  handler=context.__nativeFactory({platformUrl:'https://platform.example',serviceKey:'synthetic-service-key',fetch:async(url,init={})=>{
    const path=new URL(url).pathname;
    const body=init.body?JSON.parse(init.body):null;
    calls.push({kind:'rpc',path,body,authorization:init.headers?.Authorization||''});
    if(path==='/auth/v1/user')return json({id:calls.who.id});
    if(path==='/rest/v1/profiles')return json([{user_id:calls.who.id,full_name:calls.who.name,role:calls.who.department,active:true,archived_at:null}]);
    if(path==='/rest/v1/user_profiles')return json([{user_id:calls.who.actor,display_name:calls.who.name,department:calls.who.department,active:true}]);
    if(path==='/rest/v1/user_roles')return json([{role_id:runId,roles:{code:calls.who.role,organization_id:org}}]);
    if(path==='/rest/v1/rpc/cos_fleet_board_claim')return json({claimed:true,leaseRemainingMs:170000});
    if(path.endsWith('/rpc/cos_fleet_board_fail')||path.endsWith('/rpc/cos_fleet_board_progress'))return json(true);
    return json({error:'synthetic'},404);
  }});
  return {handler,calls,tasks,use(who){calls.who=who;}};
}

async function produce(handler,{token,secret,admitted,path='/api/fleet-saved-board/produce',body={run:runId}}={}){
  const headers={'Content-Type':'application/json',Origin:'https://cypressriveroasis2023-sudo.github.io'};
  if(token)headers.Authorization='Bearer synthetic-token';
  if(secret)headers['X-COS-Fleet-Board-Produce']=secret;
  if(admitted)headers['X-COS-Fleet-Produce-Admitted']='1';
  const response=await handler(new Request('https://platform.example/functions/v1/cos-fleet-board-producer',{method:'POST',headers,body:JSON.stringify({path,method:'POST',body})}));
  let parsed=null;try{parsed=await response.json();}catch{parsed=null;}
  return {status:response.status,body:parsed};
}

test('the handler keeps user-token results and still checks the claimed run for a valid secret',async()=>{
  const live=bootHandler();
  live.use(owner);
  const user=await produce(live.handler,{token:true,secret:'wrong-secret-value-not-the-real-one'});
  assert.equal(user.status,202,JSON.stringify(user.body));
  assert.equal(live.calls.some(call=>call.path?.endsWith('cos_fleet_board_claim')),true);
  live.use(service);
  const serviceUser=await produce(live.handler,{token:true,secret:SECRET});
  assert.equal(serviceUser.status,403,JSON.stringify(serviceUser.body));
  const anon=await produce(live.handler,{});
  assert.equal(anon.status,401,JSON.stringify(anon.body));
  const wrong=await produce(live.handler,{secret:'wrong-secret-value-not-the-real-one',admitted:true});
  assert.equal(wrong.status,401);
  const missingRun=await produce(live.handler,{secret:SECRET,admitted:true,body:{}});
  assert.equal(missingRun.status,400,JSON.stringify(missingRun.body));
  assert.equal(missingRun.body.error,'Exact saved board batch required');
  const before=live.calls.filter(call=>call.path?.endsWith('cos_fleet_board_claim')).length;
  const secretOk=await produce(live.handler,{secret:SECRET,admitted:true});
  assert.equal(secretOk.status,202,JSON.stringify(secretOk.body));
  assert.equal(live.calls.filter(call=>call.path?.endsWith('cos_fleet_board_claim')).length,before+1);
  const other=await produce(live.handler,{secret:SECRET,admitted:true,path:'/api/jobs',body:null});
  assert.equal(other.status,401,JSON.stringify(other.body));
  assert.notEqual(other.body?.error,'gone');
  await Promise.allSettled(live.tasks);
  const hops=live.calls.filter(call=>call.kind==='hop');
  assert.ok(hops.every(hop=>hop.authorization!=='Bearer synthetic-service-key'));
});

test('next_at becomes 5 minutes and a due tick does not overlap a build still inside the 180-second lock',async()=>{
  const rollbackSql=readFileSync(join(root,'.github/function-patches/cos-fleet-board-begin/rollback-live.sql'));
  assert.equal(sha(rollbackSql),'c8c83dc9b58c786e16b5fa599e01c9fef2f4137b3d0ff60818e98015af36a633');
  const cadence=readFileSync(join(root,'.github/function-patches/cos-fleet-board-begin/cadence-5min.sql'),'utf8');
  assert.equal(cadence.includes(rollbackSql.toString('utf8').replace("interval '10 minutes'","interval '5 minutes'")),true);
  assert.match(cadence,/c8c83dc9b58c786e16b5fa599e01c9fef2f4137b3d0ff60818e98015af36a633/);
  const cron=readFileSync(join(root,'.github/function-patches/cos-fleet-board-begin/produce-cron.sql'),'utf8');
  assert.match(cron,/cron\.schedule/);
  assert.match(cron,/net\.http_post/);
  assert.match(cron,/'\*\/5 \* \* \* \*'/);
  assert.match(cron,/cos_fleet_board_begin\(false/);
  assert.match(cron,/X-COS-Fleet-Board-Produce/);
  assert.match(cron,/fleet_board_produce_secret/);
  assert.match(cron,/\/api\/fleet-saved-board\/produce/);
  assert.equal(cron.split('\n').some(line=>!line.trim().startsWith('--')&&line.includes('cron.schedule(')),false);
  assert.doesNotMatch(cron,/COS_FLEET_BOARD_PRODUCE_SECRET'\s*[:=]\s*'[^']+'/);
  const db=new PGlite();
  await db.exec('create role service_role bypassrls;create role anon;create role authenticated;');
  for(const file of ['fleet-durable-board-install.sql','fleet-board-staging.sql','fleet-board-reliability-20261109.sql']){
    await db.exec(readFileSync(join(root,'tech-checks/operations/db',file),'utf8'));
  }
  await db.exec(cadence.slice(cadence.indexOf('CREATE OR REPLACE FUNCTION')));
  await db.exec('reset role;set role service_role;');
  const one=async(sql,args=[])=>Object.values((await db.query(sql,args)).rows[0]||{})[0]??null;
  const first=await one('select public.cos_fleet_board_begin(false)');
  assert.ok(first.id);
  const gap=Number(await one('select extract(epoch from (next_at-clock_timestamp())) from cos_fleet_board_private.control'));
  assert.ok(gap>290&&gap<310,'next_at is five minutes');
  await db.exec("reset role;update cos_fleet_board_private.control set next_at=clock_timestamp()-interval '1 second';set role service_role;");
  assert.equal(await one('select public.cos_fleet_board_begin(false)'),null);
  assert.equal(Number(await one("select count(*) from cos_fleet_board_private.runs where state='running'")),1);
  await db.exec('reset role;');
  await assert.rejects(()=>db.exec('set role anon;select public.cos_fleet_board_begin(false);'));
  await db.close();
});
