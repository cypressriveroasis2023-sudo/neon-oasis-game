// Runs only against a disposable loopback PostgreSQL database. No production data.
import assert from 'node:assert/strict';
import {readFileSync} from 'node:fs';
import pg from 'pg';
const raw=process.env.RECON_TEST_DATABASE_URL;
if(!raw)throw Error('Missing RECON_TEST_DATABASE_URL');
const url=new URL(raw);
if(!['127.0.0.1','localhost','[::1]'].includes(url.hostname)||!url.pathname.startsWith('/recon_ordering_test_'))throw Error('Refusing non-test or non-loopback database');
let passes=0;
async function connect(){
 const c=new pg.Client({connectionString:raw});
 c.on('notice',n=>{if(n.message?.startsWith('PASS:')){passes++;console.log(n.message)}});
 await c.connect();await c.query("SET client_min_messages='log'");return c;
}
const file=name=>readFileSync(new URL(name,import.meta.url),'utf8');
assert.equal(file('migration-proposal.sql'),file('../../../../database-maintenance/reconeyez-event-ordering.sql'),'CI must exercise the exact deployable maintenance SQL');
let c=await connect();
try{
 const {rows}=await c.query("SELECT version() AS full_version,current_setting('server_version') AS version,current_setting('server_version_num') AS version_num");
 console.log('Real PostgreSQL server:',rows[0].full_version);
 assert.match(rows[0].version,/^17\.6(?:\s|$)/);assert.equal(rows[0].version_num,'170006');
 for(const path of ['schema.sql','migration-proposal.sql','integration.sql'])await c.query(file(path));
}finally{await c.end()}
c=await connect();try{await c.query(file('top-level-rollback-setup.sql'))}finally{await c.end()}
c=await connect();try{
 await assert.rejects(()=>c.query(file('top-level-rollback-fail.sql')),/injected top-level history failure/);
 await c.query('ROLLBACK');
}finally{await c.end()}
c=await connect();try{await c.query(file('top-level-rollback-verify.sql'))}finally{await c.end()}
assert.equal(passes,48,'Every database assertion must execute');
console.log(`${passes} real-server SQL assertions passed, including separate top-level transaction rollback.`);
