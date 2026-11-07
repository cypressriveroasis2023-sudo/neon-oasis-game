// Hosted-only backend for the unchanged synthetic schema. Never opens a local DB.
import assert from 'node:assert/strict';
import {randomUUID} from 'node:crypto';
import pg from 'pg';
pg.types.setTypeParser(1184,value=>value);pg.types.setTypeParser(1114,value=>value);
pg.types.setTypeParser(20,value=>{const n=Number(value);return Number.isSafeInteger(n)?n:value});
export function hostedConfiguration(){
 assert.equal(process.env.GITHUB_ACTIONS,'true','Real PG proof is hosted-only; do not spoof this locally');
 assert.equal(process.env.RECON_SYNTHETIC_HOSTED_PROOF,'yes','Explicit synthetic proof job marker required');
 assert.equal(process.env.RECON_PROOF_BACKEND,'hosted-postgres');
 const url=new URL(process.env.RECON_TEST_DATABASE_URL??'');
 assert(['127.0.0.1','localhost'].includes(url.hostname),'Refuse remote database');
 assert.equal(url.pathname,'/recon_proof_control');assert.equal(url.username,'postgres');
 assert.equal(url.search,'');assert.equal(url.hash,'');return url;
}
const quote=id=>'"'+id.replaceAll('"','""')+'"';
export async function createEngine(){
 const base=hostedConfiguration(),control=new pg.Client({connectionString:base.href});
 const name='recon_proof_'+randomUUID().replaceAll('-',''),url=new URL(base);url.pathname='/'+name;
 let main,closed=false,connected=false,locked=false,databaseAttempted=false,baseline;
 const extraClients=new Set();
 async function close(){
  if(closed)return;closed=true;const errors=[];
  const attempt=async fn=>{try{await fn();return true}catch(e){errors.push(e);return false}};
  try{
   for(const c of extraClients)await attempt(()=>c.end());if(main)await attempt(()=>main.end());
   const dropped=!databaseAttempted||await attempt(()=>control.query('DROP DATABASE IF EXISTS '+quote(name)+' WITH (FORCE)'));
   if(connected&&baseline&&databaseAttempted&&dropped){
    await attempt(async()=>{
     const added=(await control.query('SELECT rolname FROM pg_roles')).rows.map(x=>x.rolname).filter(x=>!baseline.includes(x));
     assert(added.every(x=>['anon','authenticated','service_role'].includes(x)||/^synthetic_(recon|receipt)_/.test(x)),'Unexpected role introduced by fixture');
     for(const role of added)await attempt(()=>control.query('DROP ROLE '+quote(role)));
    });
   }
  }finally{
   if(connected&&locked)await attempt(()=>control.query('SELECT pg_advisory_unlock(41839,20261014)'));
   await attempt(()=>control.end()); // Closing control also releases any uncertain session lock.
  }
  if(errors.length)throw new AggregateError(errors,'Synthetic PostgreSQL fixture cleanup failed');
 }
 try{
  await control.connect();connected=true;
  await control.query("SET application_name='recon-hosted-proof-control';SET statement_timeout='30s';SET lock_timeout='12s'");
  await control.query('SELECT pg_advisory_lock(41839,20261014)');locked=true;
  baseline=(await control.query('SELECT rolname FROM pg_roles')).rows.map(x=>x.rolname);
  assert(!['anon','authenticated','service_role'].some(x=>baseline.includes(x)),'Service must be fresh and dedicated, not an existing app database');
  databaseAttempted=true;await control.query('CREATE DATABASE '+quote(name)+' TEMPLATE template0');
  async function connect(label='worker'){
   const c=new pg.Client({connectionString:url.href,application_name:'recon-proof-'+label});extraClients.add(c);
   try{await c.connect();await c.query("SET statement_timeout='20s';SET lock_timeout='10s'");
    await c.query("SELECT set_config('TimeZone',$1,false)",[process.env.TZ??'UTC']);return c;
   }catch(error){await c.end().catch(()=>{});extraClients.delete(c);throw error}
  }
  main=await connect('fixture');extraClients.delete(main);
  const db={query:(sql,args=[])=>main.query(sql,args.map(v=>Array.isArray(v)?JSON.stringify(v):v)),exec:sql=>main.query(sql),connectionString:url.href,connect,close,
   async transaction(fn){await main.query('BEGIN');try{const r=await fn(db);await main.query('COMMIT');return r}catch(e){await main.query('ROLLBACK');throw e}}
  };
  assert.equal((await main.query('SHOW server_version_num')).rows[0].server_version_num,'170006','Proposed pinned PG17.6 runtime');
  return db;
 }catch(error){try{await close()}catch(cleanupError){throw new AggregateError([error,cleanupError],'Synthetic PostgreSQL setup and cleanup failed')}throw error}
}
