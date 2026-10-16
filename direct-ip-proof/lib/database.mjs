import assert from 'node:assert/strict';
import {randomUUID} from 'node:crypto';

export const selectedBackend=()=>process.env.DIRECT_IP_PROOF_POSTGRES==='1'?'postgres':'pglite';
export function assertHostedPostgres() {
 assert.equal(process.env.GITHUB_ACTIONS,'true','Real PostgreSQL is hosted-CI only; no local server is authorized.');
 assert.equal(process.env.DIRECT_IP_PROOF_POSTGRES,'1');
 // No caller-supplied URL, credentials or destination are accepted.
}
export async function openDatabase(backend=selectedBackend()) {
 if(backend==='pglite') {
  const {PGlite}=await import('@electric-sql/pglite');
  const pg=new PGlite();return {pg,backend,close:()=>pg.close()};
 }
 assert.equal(backend,'postgres');assertHostedPostgres();
 const {Client}=await import('pg');
 const clients=new Set();
 const newClient=async()=>{
  const c=new Client({host:'127.0.0.1',port:5432,user:'postgres',database:'direct_ip_proof',password:'synthetic-ci-only',
   application_name:'direct-ip-proof-'+randomUUID(),connectionTimeoutMillis:5000,statement_timeout:15000,query_timeout:18000});
  await c.connect();clients.add(c);return c;
 };
 const c=await newClient();
 const pg={query:(...args)=>c.query(...args),exec:sql=>c.query(sql),
  transaction:async fn=>{await c.query('begin');try{const value=await fn(pg);await c.query('commit');return value;}catch(e){await c.query('rollback');throw e;}}};
 return {pg,backend,admin:c,newClient,
  async close(){await Promise.allSettled([...clients].map(c=>c.end()));}};
}
