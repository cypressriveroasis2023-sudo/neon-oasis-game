// In-process syntax/contract check only. Never invokes advisory/native contention.
import assert from 'node:assert/strict';import {readFile} from 'node:fs/promises';
import {fixture,inventoryInput} from '../tech-checks/operations/tests/fixtures/recon-owned-metadata-v2.mjs';
const source=await readFile(new URL('./postgrest-transport.test.mjs',import.meta.url),'utf8');
const match=/await f\.db\.exec\(`([\s\S]*?)`\);/.exec(source);assert(match);assert(!match[1].includes('${'));
const f=await fixture();try{
 await f.db.exec(match[1]);const token=await f.begin();await f.failure(token);const input=await inventoryInput(token.observed_at);
 for(let i=0;i<2;i++)await assert.rejects(f.rpc('synthetic_business_conflict',{p_attempt_id:token.attempt_id,p_input:input}),e=>e.code==='PT409');
 await assert.rejects(f.rpc('synthetic_business_conflict',{p_attempt_id:token.attempt_id,p_input:input}),e=>e.code==='P0001');
 assert.equal(await f.scalar('SELECT last_value AS value FROM synthetic_business_attempts'),3);
 console.log('PASS: proposed transport SQL compiles; actual business conflict and nonretryable safety ceiling retain exact codes. PGlite only; no HTTP/native contention run.');
}finally{await f.close()}
