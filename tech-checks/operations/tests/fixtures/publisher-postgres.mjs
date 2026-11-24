// Optional real PostgreSQL harness. Only disposable databases on loopback.
import {createRequire} from 'node:module';
import {randomUUID} from 'node:crypto';
export async function publisherPostgres(){
 const raw=process.env.COS_PUBLISHER_TEST_DATABASE_URL;if(!raw)return undefined;
 const url=new URL(raw);
 if(!['postgres:','postgresql:'].includes(url.protocol)||!['localhost','127.0.0.1','[::1]'].includes(url.hostname)||url.search||url.hash||url.pathname!=='/cos_publisher_test_local')throw Error('Disposable loopback cos_publisher_test_local database required');
 const require=createRequire(new URL('../../legacy/tests/recon-ordering/package.json',import.meta.url));const {Client}=require('pg');
 const adminUrl=new URL(url);adminUrl.pathname='/postgres';const admin=new Client({connectionString:adminUrl.href});await admin.connect();
 const name='cos_publisher_test_'+randomUUID().replaceAll('-','');
 await admin.query(`DO $$BEGIN CREATE ROLE anon;EXCEPTION WHEN duplicate_object THEN NULL;END$$;DO $$BEGIN CREATE ROLE authenticated;EXCEPTION WHEN duplicate_object THEN NULL;END$$;DO $$BEGIN CREATE ROLE service_role;EXCEPTION WHEN duplicate_object THEN NULL;END$$;`);
 await admin.query('CREATE DATABASE '+name);url.pathname='/'+name;
 const clients=[];
 const connect=async()=>{const c=new Client({connectionString:url.href});await c.connect();await c.query("SET statement_timeout='10s';SET lock_timeout='5s'");clients.push(c);return c;};
 const client=await connect();
 const query=(sql,args=[])=>client.query(sql,args.map(v=>v!==null&&typeof v==='object'?JSON.stringify(v):v));
 return {query,exec:sql=>client.query(sql),connect,async close(){for(const c of clients)await c.end();await admin.query('DROP DATABASE '+name);await admin.end();}};
}
