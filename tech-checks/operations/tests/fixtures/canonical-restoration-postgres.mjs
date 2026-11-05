import {createRequire} from 'node:module';
import {randomUUID} from 'node:crypto';
export async function disposableRestorationPostgres(){
 const url=new URL(process.env.COS_RESTORATION_TEST_DATABASE_URL??'invalid:');
 if(!['postgres:','postgresql:'].includes(url.protocol)||!['127.0.0.1','localhost','[::1]'].includes(url.hostname)
  ||!/^\/cos_restoration_test_[a-z0-9_]+$/.test(url.pathname)||url.search||url.hash)throw Error('Disposable loopback restoration database required');
 const require=createRequire(new URL('../../legacy/tests/recon-ordering/package.json',import.meta.url));
 const {Client}=require('pg');const adminUrl=new URL(url);adminUrl.pathname='/postgres';
 const admin=new Client({connectionString:adminUrl.href});await admin.connect();
 const name='cos_restoration_test_'+randomUUID().replaceAll('-','');await admin.query('create database '+name);url.pathname='/'+name;
 const clients=[];
 const connect=async()=>{const c=new Client({connectionString:url.href});await c.connect();await c.query("set statement_timeout='15s';set lock_timeout='4s'");clients.push(c);return c;};
 const client=await connect();
 return {connect,client,
  exec:sql=>client.query(sql.replace(/create role (anon|authenticated|service_role);/g,(_,r)=>`do $$begin if not exists(select 1 from pg_roles where rolname='${r}') then create role ${r};end if;end$$;`)),
  query:(sql,p=[])=>client.query(sql,p.map(x=>x!==null&&typeof x==='object'?JSON.stringify(x):x)),
  close:async()=>{for(const c of clients){await c.query('rollback').catch(()=>{});await c.end();}await admin.query('drop database '+name);await admin.end();},
 };
}
