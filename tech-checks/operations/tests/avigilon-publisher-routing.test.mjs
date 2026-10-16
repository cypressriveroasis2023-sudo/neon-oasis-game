import test from 'node:test';import assert from 'node:assert/strict';import {collectScheduledDirect} from '../../supabase/functions/_shared/scheduledDirectService.ts';import {configureReviewedAvigilonRuntime} from '../../supabase/functions/_shared/avigilonReviewedRuntime.ts';import {createAvigilonProductionCandidate} from '../../supabase/functions/_shared/avigilonProductionCandidate.ts';import {readFile} from 'node:fs/promises';
test('disabled candidate does no IO; managed scheduled route uses native receipts and never falls back to legacy publication',async()=>{
 assert.equal(createAvigilonProductionCandidate({enabled:false,fetch:()=>{throw Error('disabled IO');}}),undefined);
 let calls=0;const receipt={run:{state:'completed',rows:[{publicationReceipt:'73'}]},results:[{published:true,publicationReceipt:'73'}]};configureReviewedAvigilonRuntime({sources:{mutate:async()=>{},reconcile:async()=>{}},checkManaged:async()=>{calls++;return receipt;}});
 const forbidden=new Proxy({},{get(){throw Error('Legacy publisher forbidden');}});assert.equal(await collectScheduledDirect(forbidden,()=>{throw Error('Legacy probe forbidden');}),receipt);assert.equal(calls,1);
 for(const file of ['camera-provider-reconcile','vigilant-sync','reconeyez-connect','reconeyez-webhook']){const code=await readFile(new URL('../../supabase/functions/'+file+'/index.ts',import.meta.url),'utf8');assert.match(code,/guardedAvigilonClient\(createClient\(/);}
 const code=await readFile(new URL('../../supabase/functions/camera-provider-reconcile/index.ts',import.meta.url),'utf8');assert.match(code,/async function avigilonInventory\(db:any\)\{\s+const managed=reviewedAvigilonRuntime\(\);if\(managed\)return managed.checkManaged\(\)/);
});

 test('ordered event adapter rejects cancellation and missing receipts',async()=>{
 const {avigilonAuthorityClient}=await import('../../supabase/functions/_shared/avigilonAuthorityClient.ts');
 for(const result of [{},{receipt:{cancelled:true,results:[]}}]){
  const db=avigilonAuthorityClient({rpc(){throw Error('Unfenced RPC forbidden');}},{mutate:async()=>result});
  const response=await db.rpc('cos_apply_recon_event_v1',{p_event_id:1});
  assert.equal(response.data,null);assert.match(response.error.message,/held/);
 }
 });

test('enabled candidate requires and forwards the host background lifecycle',async()=>{
 const options={enabled:true,actor:{tenantId:'ece6d2a2-fd19-4cc7-b56a-2fa004a6d8f5',actorId:'10000000-0000-4000-8000-000000000001',canCheck:true},platformUrl:'https://native.invalid',serviceKey:'synthetic',legacyUrl:'https://goqrnolcvqnirjmzaeyk.supabase.co',legacyServiceKey:'synthetic',fetch:()=>{throw Error('Unexpected IO');},probe:async()=>{throw Error('Unexpected probe');}};
 assert.throws(()=>createAvigilonProductionCandidate(options),/background lifecycle/);
 const retained=[];const candidate=createAvigilonProductionCandidate({...options,background:work=>retained.push(work)});const job=Promise.resolve();candidate.checks.background(job);assert.deepEqual(retained,[job]);await job;
});
