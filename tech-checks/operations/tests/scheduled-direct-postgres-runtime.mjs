/** Original publisher + actual scheduled helper/handler. All sockets are synthetic. */
import assert from 'node:assert/strict';
import {spawn} from 'node:child_process';
import {readFile} from 'node:fs/promises';
import {pathToFileURL} from 'node:url';
import {createRequire} from 'node:module';
import {createHash} from 'node:crypto';
import {collectScheduledDirect} from '../../supabase/functions/_shared/scheduledDirectService.ts';

const [psql,port,database,user]=process.argv.slice(2);
assert.ok(psql&&/^\d+$/.test(port)&&/^scheduled_direct_test_[a-f0-9]+$/.test(database)&&user);
const candidateFiles={};
for(const relative of ['../../supabase/functions/_shared/scheduledDirectService.ts','../../supabase/functions/camera-health-sweep/index.ts']){
 const bytes=await readFile(new URL(relative,import.meta.url));candidateFiles[relative]=createHash('sha256').update(bytes).digest('hex');
}
const delayMs=Number(process.env.SCHEDULED_PROBE_DELAY_MS??2200);
assert.ok(Number.isFinite(delayMs)&&delayMs>=0&&delayMs<=2200);
const quote=value=>"'"+String(value).replaceAll("'","''")+"'";
const identifier=value=>{assert.match(value,/^[a-z_][a-z0-9_]*$/);return '"'+value+'"';};
const tables=new Set(['equipment_master','camera_devices','camera_health_current','camera_unit_routers','camera_integrations']);
let sequence=0;
const rpcSamples=[],querySamples=[],activeRpcDevices=new Set(),readSessions=new Map();
let mask32Facade=false,cronAuthBoundaries=0,integrationHealthChecks=0;
const maskedRpcInputs=[];
async function sql(query,{app='scheduled-observer',signal}={}){
 return new Promise((resolve,reject)=>{
  if(signal?.aborted)return reject(Error('Request aborted'));
  const child=spawn(psql,['-X','--no-password','-h','127.0.0.1','-p',port,'-U',user,'-d',database,'-v','ON_ERROR_STOP=1','-qAt'],{env:{...process.env,PGAPPNAME:app}});
  let out='',err='';const abort=()=>child.kill('SIGTERM');signal?.addEventListener('abort',abort,{once:true});
  child.stdout.on('data',buffer=>out+=buffer);child.stderr.on('data',buffer=>err+=buffer);child.on('error',reject);
  child.on('close',code=>{signal?.removeEventListener('abort',abort);if(code)return reject(Error(err||'Request aborted'));try{resolve(out.trim()==='t'?true:out.trim()==='f'?false:out.trim()?JSON.parse(out.trim()):null);}catch(error){reject(error);}});
  child.stdin.end(query);
 });
}
const healthState=()=>sql("select jsonb_build_object('current',(select jsonb_agg(to_jsonb(h) order by camera_device_id) from camera_health_current h),'history',(select jsonb_agg(to_jsonb(h) order by id) from camera_health_history h))");
const preserved=()=>sql("select jsonb_build_object('source',(select jsonb_agg(to_jsonb(e) order by id) from equipment_master e),'placement',(select jsonb_agg(to_jsonb(d)-array['last_health_checked_at','last_probe_online_at'] order by id) from camera_devices d))");
function deferred(make){let signal,promise;const result={abortSignal(value){signal=value;return result;},then(resolve,reject){return (promise??=make(signal)).then(resolve,reject);}};return result;}
function databaseFacade(){
 return {
  from(table){
   assert.ok(tables.has(table));let filters=[],order='',limit='',patch=null,signal,selected=false,projection='*';
   const query={select(fields='*'){selected=true;projection=fields==='*'?'*':fields.split(',').map(identifier).join(',');return query;},eq(k,v){filters.push(identifier(k)+'='+quote(v));return query;},is(k,v){assert.equal(v,null);filters.push(identifier(k)+' is null');return query;},
    in(k,values){filters.push(values.length?identifier(k)+' in ('+values.map(quote).join(',')+')':'false');return query;},
    or(expression){
     const clauses=expression.split(',').map(clause=>{
      const notNull=clause.match(/^([a-z_]+)\.not\.is\.null$/);if(notNull)return identifier(notNull[1])+' is not null';
      const ilike=clause.match(/^([a-z_]+)\.ilike\.(.+)$/);assert.ok(ilike,'Unsupported fixture OR clause');return identifier(ilike[1])+' ilike '+quote(ilike[2]);
     });filters.push('('+clauses.join(' or ')+')');return query;
    },
    order(k,options={}){order=' order by '+identifier(k)+(options.ascending===false?' desc':' asc')+(options.nullsFirst?' nulls first':'');return query;},
    limit(value){assert.ok(Number.isInteger(value)&&value>0);limit=' limit '+value;return query;},
    update(value){patch=value;return query;},abortSignal(value){signal=value;return query;},
    then(resolve,reject){
     const app='scheduled-db-'+(++sequence),where=filters.length?' where '+filters.join(' and '):'';
     let statement;
     if(patch){
      assert.ok(['camera_unit_routers','camera_integrations'].includes(table),'Only original publisher may write camera health');
      const set=Object.entries(patch).map(([key,value])=>identifier(key)+'='+(value===null?'null':typeof value==='object'?quote(JSON.stringify(value))+'::jsonb':quote(value))).join(',');
      statement='with changed as (update '+identifier(table)+' set '+set+where+' returning '+(selected?projection:'*')+') select coalesce(jsonb_agg(to_jsonb(changed)),\'[]\'::jsonb) from changed';
     }else statement='select coalesce(jsonb_agg(to_jsonb(t)),\'[]\'::jsonb) from (select '+projection+' from '+identifier(table)+where+order+limit+') t';
     const execute=async()=>{
      const healthBefore=patch&&table==='camera_integrations'?await healthState():null;
      let data=await sql(statement,{app,signal});
      if(healthBefore){assert.deepEqual(await healthState(),healthBefore);integrationHealthChecks++;}
      if(!patch){readSessions.set(table,app);if(mask32Facade&&table==='camera_devices')data=data.map(row=>({...row,public_ip:typeof row.public_ip==='string'?row.public_ip.replace(/\/32$/,'')+'/32':row.public_ip}));}
      querySamples.push({table,operation:patch?'write':'read',returnedRows:selected?data.length:0,compactJsonBytes:selected?Buffer.byteLength(JSON.stringify(data),'utf8'):0});
      return {data:selected?data:null,error:null};
     };return execute().then(resolve,reject);
    }};return query;
  },
  rpc(name,args){return deferred(async signal=>{
   if(name==='verify_camera_health_cron_secret'){cronAuthBoundaries++;return {data:args.candidate==='synthetic-cron-secret',error:null};}
   assert.equal(name,'publish_camera_connection_v1');assert.equal(Object.keys(args).length,7);
   assert.equal(Object.hasOwn(args.p_health,'_directSource'),false);
   if(mask32Facade)maskedRpcInputs.push({id:args.p_device_id,ip:args.p_public_ip});
   const id=args.p_device_id,app='scheduled-rpc-'+(++sequence),call='public.publish_camera_connection_v1('+[
    String(id),String(args.p_revision),quote(args.p_public_ip)+'::inet',quote('{'+args.p_expected_ports.join(',')+'}')+'::integer[]',
    quote(args.p_monitoring_profile),quote(JSON.stringify(args.p_health))+'::jsonb',quote(args.p_source)].join(',')+')';
   activeRpcDevices.add(id);const started=performance.now();
   try{
    const result=await sql("begin;set local role service_role;set local request.jwt.claim.role='service_role';with started as materialized(select clock_timestamp() t), answer as materialized(select "+call+" value from started) select jsonb_build_object('value',value,'databaseMs',extract(epoch from(clock_timestamp()-t))*1000) from started,answer;commit;",{app,signal});
    rpcSamples.push({databaseMs:Number(result.databaseMs),wallMs:performance.now()-started,ok:result.value.ok});return {data:result.value,error:null};
   }finally{activeRpcDevices.delete(id);}
  });}
 };
}
const before=await preserved();
// A change observed by the final inventory reread is held before publication.
const mutationCases=[
 {name:'retired source',change:"update equipment_master set tracker_state='retired' where id=1",restore:"update equipment_master set tracker_state='shop' where id=1"},
 {name:'source identity',change:"update equipment_master set source_label='Sniper 999' where id=1",restore:"update equipment_master set source_label='Sniper 001' where id=1"},
 {name:'device ownership',change:"update camera_devices set source='other_owner' where id=1",restore:"update camera_devices set source='2026_unit_tracker' where id=1"},
];
for(const mutation of mutationCases){
 let changed=false;
 const result=await collectScheduledDirect(databaseFacade(),async host=>{
  if(host==='8.8.4.1'&&!changed){changed=true;await sql(mutation.change+';select true');}
  return {online:true,latency_ms:0};
 });
 assert.ok(changed);const target=result.results.find(row=>row.id===1);assert.equal(target.published,false,mutation.name);assert.equal(target.reason,'source_or_connection_changed',mutation.name);
 await sql(mutation.restore+';select true');
}
assert.deepEqual(await preserved(),before);
console.log(JSON.stringify({status:'passed',actualRole:'service_role',sourceRereadDeclines:mutationCases.map(c=>c.name),originalPublisher:true,sourcePlacementRestored:true,remainingRace:'A change after the final client reread can still pass the unchanged publisher.',productionCalls:0}));

// Simulate the inet /32 representation returned by an API while the original
// PostgreSQL publisher writes host(d.public_ip), which omits the suffix.
await sql("update camera_devices set public_ip='8.8.4.1/32'::inet where id=1;select true");
mask32Facade=true;
await collectScheduledDirect(databaseFacade(),async()=>({online:true,latency_ms:0}));
const maskCounters=[];
for(const expected of [1,2,3]){
 const result=await collectScheduledDirect(databaseFacade(),async()=>({online:false,latency_ms:null,error:'synthetic timeout'}));
 assert.equal(result.results.find(row=>row.id===1).published,true);
 const proof=await sql("select port_status->'_connection' from camera_health_current where camera_device_id=1");
 assert.equal(proof.ip,'8.8.4.1');assert.equal(proof.consecutiveFailures,expected);maskCounters.push(proof.consecutiveFailures);
 assert.equal(proof.status,expected===3?'offline':'verifying');assert.equal(proof.confirmedOutage,expected===3);
}
mask32Facade=false;
assert.equal(maskedRpcInputs.filter(row=>row.id===1).every(row=>row.ip==='8.8.4.1/32'),true);
assert.deepEqual(await preserved(),before);
console.log(JSON.stringify({status:'passed',originalPublisher:true,savedEndpointMask:32,publisherProofHostNormalized:true,failureCounters:maskCounters,streakResetBetweenFailures:false,sourcePlacementPreserved:true,productionCalls:0}));

// Match saved-capture cardinalities; addresses, identities and sockets are synthetic.
await sql("with added as (insert into equipment_master(id,canonical_family,unit_tag,source_label,tracker_state,tracker_public_ip,address,updated_at) select 1000+n,'Sniper',(800000+n)::text,'Sniper '||(800000+n),case when n>175 then 'retired' when n%2=0 then 'shop' else 'field_or_unknown' end,('8.9.'||(n/250)||'.'||(n%250+1))::inet,'Synthetic address',now() from generate_series(1,180) n returning id) select count(*)::int from added");
await sql("with added as (insert into camera_devices(id,unit_key,source,public_ip,expected_ports,monitoring_profile,organization,activation_state,public_ip_source,device_name) select 1000+n,'SNIPER '||(800000+n),'2026_unit_tracker',('8.9.'||(n/250)||'.'||(n%250+1))::inet,'{80,443,8443,38880,38881}','sniper','root','deactivated','tracker','Sniper '||(800000+n) from generate_series(1,180) n returning id) select count(*)::int from added");
await sql("with added as (insert into equipment_master(id,canonical_family,unit_tag,source_label,tracker_state) select 10000+n,'Other',n::text,'Other '||n,'shop' from generate_series(1,515) n returning id) select count(*)::int from added");
await sql("with added as (insert into camera_devices(id,unit_key,source,monitoring_profile) select 10000+n,'Other '||n,'other_provider','other' from generate_series(1,555) n returning id) select count(*)::int from added");
await sql("create table camera_unit_routers(id bigint primary key,unit_key text,router_name text,router_model text,router_public_ip inet,unit_ip inet,web_port integer,web_protocol text,reported_status text,reported_latency_ms numeric,status_source text,status_observed_at timestamptz,current_status text,last_checked_at timestamptz,last_online_at timestamptz,updated_at timestamptz);insert into camera_unit_routers(id,unit_key,router_name,router_model,router_public_ip,web_port,updated_at) select n,'ROUTER '||n,'Synthetic router '||n,'Synthetic',('8.10.0.'||n)::inet,8080,'2026-01-01'::timestamptz from generate_series(1,25) n;create table camera_integrations(provider text primary key,last_sync_at timestamptz,last_sync_status text,last_error text,metadata jsonb);insert into camera_integrations values('avigilon',null,null,null,'{}');select true");
const cardinality=await sql("select jsonb_build_object('equipmentMaster',(select count(*) from equipment_master),'cameraDevices',(select count(*) from camera_devices),'directFamilyCohort',(select count(*) from equipment_master where canonical_family in ('CAMV','Sniper','Sniper 2','Sniper 4')),'routers',(select count(*) from camera_unit_routers))");
assert.deepEqual(cardinality,{equipmentMaster:699,cameraDevices:739,directFamilyCohort:184,routers:25});
const fixtureState=await preserved();
const devices=await sql("select jsonb_agg(to_jsonb(d)) from camera_devices d where monitoring_profile in ('sniper','camv')"),byHost=new Map(devices.map(d=>[d.public_ip.replace(/\/32$/,''),d.id]));
const probeHosts=new Set(),socketCalls=[],lockProofs=new Map();let socketDelayStarted=false;
async function verifyProbeBoundary(host){
 if(lockProofs.has(host))return lockProofs.get(host);
 const promise=(async()=>{
  if(byHost.has(host))assert.equal(activeRpcDevices.has(byHost.get(host)),false);
  const relevant=host.startsWith('8.10.')?['camera_unit_routers']:['equipment_master','camera_devices'];
  const sessions=relevant.map(table=>readSessions.get(table)).filter(Boolean);assert.equal(sessions.length,relevant.length);
  const locks=await sql('select count(*)::int from pg_locks l join pg_stat_activity a on a.pid=l.pid where a.application_name in ('+sessions.map(quote).join(',')+')');assert.equal(locks,0);
 })();lockProofs.set(host,promise);return promise;
}
let handler;
const originalDeno=globalThis.Deno;
globalThis.Deno={env:{get:key=>key==='SUPABASE_URL'?'https://synthetic.invalid':'synthetic-service-key'},serve:fn=>{handler=fn;},connect:async({hostname,port:servicePort,signal})=>{
 assert.ok(byHost.has(hostname)||hostname.startsWith('8.10.'));probeHosts.add(hostname);socketCalls.push({host:hostname,port:servicePort});socketDelayStarted=true;
 const started=performance.now();await verifyProbeBoundary(hostname);
 await new Promise((resolve,reject)=>{
  let timer;const abort=()=>{clearTimeout(timer);reject(Error('synthetic timeout'));};
  if(signal?.aborted)return abort();signal?.addEventListener('abort',abort,{once:true});
  timer=setTimeout(()=>{signal?.removeEventListener('abort',abort);reject(Error('synthetic timeout'));},Math.max(0,delayMs-(performance.now()-started)));
 });
}};
const facade=databaseFacade();globalThis.__scheduledCreateClient=()=>facade;
const handlerUrl=new URL('../../supabase/functions/camera-health-sweep/index.ts',import.meta.url),helperUrl=new URL('../../supabase/functions/_shared/scheduledDirectService.ts',import.meta.url);
let source=await readFile(handlerUrl,'utf8');
source=source.replace(/^import "jsr:@supabase\/functions-js\/edge-runtime.d.ts";\s*/m,'')
 .replace(/^import \{createClient\} from "npm:@supabase\/supabase-js@2";/m,'const createClient=globalThis.__scheduledCreateClient;')
 .replace('../_shared/scheduledDirectService.ts',helperUrl.href);
const require=createRequire('/workspace/scratch/89acc3b21a59/cos-free-geocodio-pipeline/tech-checks/operations/node_modules/tsx/dist/loader.mjs');
const {transformSync}=require('esbuild');
const code=transformSync(source,{loader:'ts',format:'esm',target:'es2022'}).code;
await import('data:text/javascript;base64,'+Buffer.from(code).toString('base64'));
assert.equal(typeof handler,'function');
rpcSamples.length=0;querySamples.length=0;cronAuthBoundaries=0;integrationHealthChecks=0;
const started=performance.now(),cpuStarted=process.cpuUsage();
const response=await handler(new Request('https://synthetic.invalid/camera-health-sweep',{method:'POST',headers:{'content-type':'application/json','x-camera-cron-secret':'synthetic-cron-secret'},body:JSON.stringify({batch_size:25})}));
const elapsed=performance.now()-started,cpu=process.cpuUsage(cpuStarted),result=await response.json();
globalThis.Deno=originalDeno;delete globalThis.__scheduledCreateClient;
assert.equal(response.status,200,JSON.stringify(result));assert.equal(result.eligible,179);assert.equal(result.held,5);assert.equal(result.deferred,0);assert.equal(result.routers_checked,25);assert.equal(result.checked,179);assert.equal(result.results.filter(r=>r.published).length,179);
assert.equal(result.results.every(r=>r.status==='verifying'||r.status==='offline'),true);assert.equal(result.router_results.every(r=>r.status==='offline'),true);assert.equal(elapsed<55_000,true,elapsed);
assert.equal(socketDelayStarted,true);assert.equal(probeHosts.size,204);assert.equal(lockProofs.size,204);await Promise.all(lockProofs.values());
assert.deepEqual(await preserved(),fixtureState);
const heartbeat=await sql("select to_jsonb(i) from camera_integrations i where provider='avigilon'");
const expectedCoverage={eligible:179,held:5,published:179,unverified:0,deferred:0,deadline_reached:false,complete:false};
for(const [field,expected] of Object.entries(expectedCoverage))assert.equal(heartbeat.metadata[field],expected,'Heartbeat '+field);
assert.equal(heartbeat.last_sync_status,'partial');assert.equal(integrationHealthChecks,1);
const heartbeatProof={lastSyncStatus:heartbeat.last_sync_status,coverage:expectedCoverage,cameraHealthAndHistoryUnchanged:true};
const times=rpcSamples.map(r=>r.databaseMs).sort((a,b)=>a-b);
const queryMetrics={};
for(const sample of querySamples){const key=sample.table+':'+sample.operation;queryMetrics[key]??={queries:0,returnedRows:0,compactJsonBytes:0};const total=queryMetrics[key];total.queries++;total.returnedRows+=sample.returnedRows;total.compactJsonBytes+=sample.compactJsonBytes;}
const readMetrics=Object.values(queryMetrics).filter((_,index)=>Object.keys(queryMetrics)[index].endsWith(':read'));
const returnedData={queryMetrics,readQueries:readMetrics.reduce((n,r)=>n+r.queries,0),returnedReadRows:readMetrics.reduce((n,r)=>n+r.returnedRows,0),compactReadJsonBytes:readMetrics.reduce((n,r)=>n+r.compactJsonBytes,0),databaseQueriesExcludingInstrumentation:querySamples.length+rpcSamples.length,mockedCronAuthBoundaries:cronAuthBoundaries,applicationDatabaseRequests:querySamples.length+rpcSamples.length+cronAuthBoundaries,measurement:'Actual selected projections; compact UTF-8 JSON arrays returned by the local facade. Measured SQL excludes the mocked cron-auth RPC; applicationDatabaseRequests includes that boundary. JSON bytes exclude HTTP framing, compression, RPC envelopes and observer queries.'};
console.log(JSON.stringify({status:'passed',actualWholeHandler:true,candidateFiles,actualRole:'service_role',originalPublisher:true,cardinality,eligible:179,published:179,retiredHeld:5,routersChecked:25,syntheticTimeoutMs:delayMs,syntheticSocketCalls:socketCalls.length,handlerWallMs:elapsed,nodeCpuMs:(cpu.user+cpu.system)/1000,publisherRpcCalls:rpcSamples.length,returnedData,heartbeatProof,rpcDatabaseMedianMs:times[Math.floor(times.length/2)],rpcDatabaseMaxMs:Math.max(...times),completedReadSessionLockChecks:lockProofs.size,sameDeviceRpcAcrossProbe:false,sourcePlacementPreserved:true,productionCalls:0,limits:'Local psql facade and instrumentation contribute CPU/latency; actual network transport and hosted edge CPU/deadline guarantees are not established.'}));

// A separate fast actual-handler invocation checks the original router CAS.
// Its direct inventory is empty so this case isolates the one due router.
const routerDatabase=databaseFacade();
const routerOnly={...routerDatabase,from(table){
 if(table!=='equipment_master')return routerDatabase.from(table);
 const empty={select(){return empty;},in(){return empty;},limit(){return empty;},abortSignal(){return empty;},then(resolve,reject){return Promise.resolve({data:[],error:null}).then(resolve,reject);}};return empty;
}};
await sql("update camera_unit_routers set last_checked_at=null,current_status='unknown' where id=1;select true");
let routerChanged=false,routerHandler;
globalThis.__scheduledCreateClient=()=>routerOnly;
globalThis.Deno={env:{get:key=>key==='SUPABASE_URL'?'https://synthetic.invalid':'synthetic-service-key'},serve:fn=>{routerHandler=fn;},connect:async({hostname,port:servicePort})=>{
 assert.equal(hostname,'8.10.0.1');assert.equal(servicePort,8080);
 await sql("update camera_unit_routers set router_public_ip='8.10.1.1',updated_at=clock_timestamp() where id=1;select true");routerChanged=true;
 return {close(){}};
}};
await import('data:text/javascript;base64,'+Buffer.from(code+'\n// Separate router configuration race fixture').toString('base64'));
const routerResponse=await routerHandler(new Request('https://synthetic.invalid/camera-health-sweep',{method:'POST',headers:{'content-type':'application/json','x-camera-cron-secret':'synthetic-cron-secret'},body:JSON.stringify({batch_size:1})}));
const routerResult=await routerResponse.json();globalThis.Deno=originalDeno;delete globalThis.__scheduledCreateClient;
assert.equal(routerResponse.status,200);assert.equal(routerChanged,true);assert.equal(routerResult.checked,0);assert.equal(routerResult.routers_checked,1);
assert.equal(routerResult.router_results[0].status,'unknown');assert.equal(routerResult.router_results[0].reason,'router_configuration_changed');
const routerAfter=await sql('select to_jsonb(r) from camera_unit_routers r where id=1');
assert.equal(routerAfter.router_public_ip,'8.10.1.1');assert.equal(routerAfter.current_status,'unknown');assert.equal(routerAfter.last_checked_at,null);
assert.deepEqual(await preserved(),fixtureState);
console.log(JSON.stringify({status:'passed',actualWholeHandler:true,routerEndpointChangedBeforeSave:true,staleRouterPublicationDeclined:true,resultStatus:'unknown',sourcePlacementPreserved:true,productionCalls:0}));

await sql("delete from camera_health_history where camera_device_id>=1000;delete from camera_health_current where camera_device_id>=1000;delete from camera_devices where id>=1000;delete from equipment_master where id>=1000;drop table camera_unit_routers;drop table camera_integrations;select true");
assert.deepEqual(await preserved(),before);
