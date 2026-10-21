/** Real separate PostgreSQL sessions, fixed ephemeral CI destination only. */
import assert from 'node:assert/strict';import {readFile} from 'node:fs/promises';import {setTimeout as sleep} from 'node:timers/promises';import {resolve} from 'node:path';import {fileURLToPath} from 'node:url';
import {assertCiContext,validateIsolatedServer,parameters,openPsql} from './mhelp-postgres-concurrency.ci.mjs';
import {statusFixture} from '../../tests/mhelp-reliability-status-fixture.mjs';
export {assertCiContext};
const json=s=>s.split(/\r?\n/).filter(x=>/^[\[{]/.test(x.trim())).map(x=>JSON.parse(x));
const exec=sql=>openPsql(sql).done;
const query=async(sql,args=[])=>json(await exec("select coalesce(json_agg(row_to_json(x)),'[]'::json) from ("+parameters(sql,args)+") x;")).at(-1);
const service=sql=>"set local role service_role;select set_config('request.jwt.claim.role','service_role',true);"+sql;
const call=async(sql,args=[])=>json(await exec('begin;'+service(parameters(sql,args))+'commit;')).at(-1);
async function waitForLock(application){for(let n=0;n<60;n++){if((await query('select wait_event_type from pg_stat_activity where application_name=$1',[application])).some(r=>r.wait_event_type==='Lock'))return;await sleep(20);}throw Error('Second PostgreSQL client did not demonstrate contention');}
async function race(sqlA,sqlB,name){const first=openPsql('begin;'+service(sqlA),{held:true,application:name+'-first'});let second;
 try{await first.ready;second=openPsql('begin;'+service(sqlB)+'commit;',{application:name+'-second'});await waitForLock(name+'-second');return [json(await first.release()).at(-1),json(await second.done).at(-1)];}
 finally{await first.release().catch(()=>first.abort());if(second)await second.done.catch(()=>second.abort());}
}
export async function main(){
 assertCiContext();validateIsolatedServer((await query('select current_database() database,current_user account,inet_server_port() port'))[0]);
 await exec(`create schema if not exists cos_mhelp_placement_private;create table if not exists cos_mhelp_placement_private.read_backoff(singleton boolean primary key,blocked_until timestamptz,probe_until timestamptz);insert into cos_mhelp_placement_private.read_backoff(singleton) values(true) on conflict do nothing;update cos_mhelp_placement_private.read_backoff set blocked_until=null,probe_until=null;`);
 for(const name of ['mhelp-request-budget.sql','mhelp-renewal-guard.sql','mhelp-inventory-cache.sql'])await exec(await readFile(new URL('../../db/'+name,import.meta.url),'utf8'));
 await exec('update cos_mhelp_placement_private.request_budget_config set initial_hold_until=null');
 const pacing=await race('select public.cos_mhelp_request_budget(false);','select public.cos_mhelp_request_budget(false);','allowance-pacing');assert.equal(pacing[0].allowed,true);assert.equal(pacing[1].allowed,false);assert.equal(pacing[1].reason,'pacing');
 await exec("update cos_mhelp_placement_private.request_budget_config set daily_limit=3,essential_reserve=1;update cos_mhelp_placement_private.request_budget_pace set next_start_at=null;update cos_mhelp_placement_private.request_budget_day set admitted=1,essential_admitted=0");
 const capped=await race('select public.cos_mhelp_request_budget(false);','select public.cos_mhelp_request_budget(false);','allowance-cap');assert.equal(capped[0].allowed,true);assert.equal(capped[1].reason,'daily_budget');
 await exec('update cos_mhelp_placement_private.request_budget_pace set next_start_at=null');assert.equal((await call('select public.cos_mhelp_request_budget(true);')).allowed,true);assert.equal((await call('select public.cos_mhelp_request_budget(true);')).reason,'daily_budget');assert.equal((await query('select admitted from cos_mhelp_placement_private.request_budget_day order by utc_day desc limit 1'))[0].admitted,3);
 await exec("update cos_mhelp_placement_private.request_budget_pace set next_start_at=null");
 const day1=json(await exec("select cos_mhelp_placement_private.admit_request_budget(false,'2030-01-01T23:59:59.999Z');")).at(-1);const day2=json(await exec("select cos_mhelp_placement_private.admit_request_budget(false,'2030-01-02T00:00:01Z');")).at(-1);assert(day1.allowed&&day2.allowed);
 await exec("update cos_mhelp_placement_private.read_backoff set blocked_until='2030-01-03T02:00:00Z'");assert.equal(json(await exec("select cos_mhelp_placement_private.admit_request_budget(true,'2030-01-03T00:01:00Z');")).at(-1).reason,'provider_wait');
 const key='224643:/customers/3?Fields=customerId,portalId,name,isServiceLocation,isActive,address1,city,state,zip,countryId',payload={customerId:3,portalId:224643,name:'Synthetic customer',isServiceLocation:false,address1:'Synthetic service street'};
 const observation=new Date().toISOString();assert.equal((await call('select public.cos_mhelp_inventory_cache($1,$2,$3::jsonb,$4::timestamptz);',['write',key,JSON.stringify(payload),observation])).saved,true);
 const cached=await call('select public.cos_mhelp_inventory_cache($1,$2);',['read',key]);assert.equal(cached.hit,true);assert.equal(Date.parse(cached.observedAt),Date.parse(observation));await exec("update cos_mhelp_placement_private.inventory_resource_cache set observed_at=clock_timestamp()-interval '4 hours'");assert.equal((await call('select public.cos_mhelp_inventory_cache($1,$2);',['read',key])).hit,false);
 // The preceding reconnect rollback proof intentionally leaves its synthetic
 // Vault fault switched on. Reset that fixture fault before our synthetic commit.
 await exec('update vault.synthetic_faults set fail_refresh=false');
 await exec('update public.cos_mhelp_token_state set lease_id=null,lease_until=null,lease_kind=null,lease_revision=null,lease_request_id=null');
 const claimed=await call("select public.cos_mhelp_token_session('claim');");assert(claimed.lease_id);
 const rejected=await race(parameters("select public.cos_mhelp_renewal_guard('reject',$1::uuid);",[claimed.lease_id]),"select public.cos_mhelp_renewal_guard('check');",'renewal-rejection');assert.equal(rejected[0].allowed,false);assert.equal(rejected[1].allowed,false);assert.equal(rejected[0].revision,rejected[1].revision);
 await call("select public.cos_mhelp_token_session('commit',$1::uuid,'synthetic-reliable-access','synthetic-reliable-refresh',clock_timestamp()+interval '24 hours');",[claimed.lease_id]);assert.equal((await call("select public.cos_mhelp_renewal_guard('check');")).allowed,true);
 await exec(statusFixture);await exec(await readFile(new URL('../../db/mhelp-reliability-status.sql',import.meta.url),'utf8'));
 const currentRevision=(await query('select revision from public.cos_mhelp_token_state where singleton'))[0].revision;
 assert.equal((await call('select public.cos_mhelp_auth_observation($1::bigint);',[Number(currentRevision)])).verified,true);
 assert.equal((await call('select public.cos_mhelp_auth_observation($1::bigint);',[Number(currentRevision)-1])).verified,false);
 const status=await call('select public.cos_mhelp_reliability_status();');assert.equal(status.auth.state,'verified');assert.equal(status.inventory.paused,true);
 assert.equal((await call('select public.cos_mhelp_renewal_failure($1::bigint);',[Number(currentRevision)])).recorded,true);
 assert.equal((await call('select public.cos_mhelp_reliability_status();')).auth.renewalCheckFailed,true);
 assert.equal((await call('select public.cos_mhelp_auth_observation($1::bigint);',[Number(currentRevision)])).verified,true);
 assert.equal((await call('select public.cos_mhelp_reliability_status();')).auth.renewalCheckFailed,false);
 assert.equal((await call("select public.cos_mhelp_inventory_read_lease('acquire');")).reason,'inventory_paused');
 assert.equal((await call('select public.cos_mhelp_placement_from_inventory();')).vendorReads,0);
 for(const role of ['anon','authenticated'])for(const sql of ["select public.cos_mhelp_renewal_failure(9);","select public.cos_mhelp_auth_observation(9);","select public.cos_mhelp_reliability_status();","select public.cos_mhelp_request_budget(false);","select public.cos_mhelp_renewal_guard('check');",parameters("select public.cos_mhelp_inventory_cache('read',$1);",[key])])await assert.rejects(exec('begin;set local role '+role+";select set_config('request.jwt.claim.role','service_role',true);"+sql+'commit;'),e=>e.sqlstate==='42501');
 console.log('PASS real distinct-client allowance pacing/cap/reserve, UTC reset/provider hold, observed cache TTL, lease-bound rejected-grant suppression/revision recovery native pause/auth evidence and denied client roles');
}
if(process.argv[1]&&resolve(process.argv[1])===fileURLToPath(import.meta.url))main().catch(e=>{console.error(e.message);process.exitCode=1;});
