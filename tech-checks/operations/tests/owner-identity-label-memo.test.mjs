import test from 'node:test';
import assert from 'node:assert/strict';
import {readFileSync} from 'node:fs';
import {transform} from 'esbuild';
import {OWNER_IDENTITY_ORG,ownerIdentityDigest,ownerConfirmedPhysicalTuple,projectOwnerConfirmedIdentities} from '../../supabase/functions/cos-operations-pages/ownerIdentityCrosswalk.ts';

// Exercise the same complete validation with its original uncached key reader.
// Restore the original provider scan and uncached label reader; no admission
// decision or physical/epoch/provenance validation is reimplemented.
const moduleUrl=new URL('../../supabase/functions/cos-operations-pages/ownerIdentityCrosswalk.ts',import.meta.url);
const source=readFileSync(moduleUrl,'utf8');
const call='currentOwnerIdentityEvidence(s,claim.native_unit_id,claim.legacy_unit_key,matchKey)';
assert.equal(source.split(call).length,2);
const providerStart=source.indexOf(' const matchedProviderIds=');
const providerEnd=source.indexOf('\n const concern=',providerStart);
assert.ok(providerStart>0&&providerEnd>providerStart);
const originalProviderScan=" if(s.matches.some(m=>s.providers.some(p=>p.id===m.vigilant_device_id&&group.some(d=>p.external_device_id===d.external_device_id&&p.source===d.source))))fail('A native provider association already claims a resource in this camera group.');";
const uncachedSource=(source.slice(0,providerStart)+originalProviderScan+source.slice(providerEnd)).replace(call,'currentOwnerIdentityEvidence(s,claim.native_unit_id,claim.legacy_unit_key)')
 .replace("'./placementProjection.ts'",JSON.stringify(new URL('./placementProjection.ts',moduleUrl).href));
const compiled=await transform(uncachedSource,{loader:'ts',format:'esm'});
const baseline=await import('data:text/javascript;base64,'+Buffer.from(compiled.code).toString('base64'));
const uuid=i=>`11111111-1111-4111-8111-${String(i).padStart(12,'0')}`;
async function fixture(){
 const s={units:[],devices:[],matches:[],providers:[],epochs:[],crosswalk:{revision:'b'.repeat(64),nativeEpochs:[],claims:[]}};
 for(let i=1;i<=20;i++){
  const unitId=uuid(i),key=`SOLARSPOTTER ${900000+i}`,label=`Spotter${900000+i}HDC2`,deviceId=String(9000+i);
  const device={id:deviceId,source:'synthetic',device_type:'IPC',unit_key:key,external_device_id:`external-${i}`,device_serial:`serial-${i}`};
  s.units.push({id:unitId,organization_id:OWNER_IDENTITY_ORG,unit_number:label,status:'available'});
  s.devices.push(device);s.epochs.push({unitKey:key,epoch:'a'.repeat(64),deviceIds:[deviceId]});
  s.crosswalk.nativeEpochs.push({unitId,epoch:'e'.repeat(64)});
  s.crosswalk.claims.push({id:uuid(100+i),organization_id:OWNER_IDENTITY_ORG,native_unit_id:unitId,native_unit_label:label,legacy_unit_key:key,device_ids:[deviceId],resource_epoch:'a'.repeat(64),physical_digest:await ownerIdentityDigest(ownerConfirmedPhysicalTuple(key,[device])),provenance:'owner_confirmation',status:'active',revision:'1'});
 }
 return s;
}
async function outcome(project,s){try{return {result:await project(s)};}catch(e){return {error:{name:e.name,message:e.message,status:e.status}};}}
async function compare(s){
 const actual=await outcome(projectOwnerConfirmedIdentities,s);
 assert.deepEqual(actual,await outcome(baseline.projectOwnerConfirmedIdentities,s));
 return actual;
}
test('twenty claims preserve every proof and warning with invocation-local label memo',async()=>{
 const s=await fixture(),before=structuredClone(s),result=await compare(s);
 assert.equal(result.result.unitIdentities.length,20);assert.deepEqual(result.result.identityWarnings,[]);assert.deepEqual(s,before);
});
for(const [name,mutate] of [
 ['malformed claim',s=>s.crosswalk.claims[0].device_ids=null],
 ['malformed source record',s=>s.devices.push(null)],
 ['non-string labels',s=>{s.units.push({id:uuid(500),unit_number:null});s.devices.push({id:'99999',unit_key:{label:'untrusted'}});}],
 ['competing normalized unit label',s=>s.units.push({...s.units[0],id:uuid(500),unit_number:'Spotter 900001HDC2'})],
 ['competing normalized device label',s=>s.devices.push({...s.devices[0],id:'99999',unit_key:'SOLAR SPOTTER 900001',device_serial:'other',external_device_id:'other'})],
 ['changed native source',s=>s.units[0].unit_number='Spotter900001HDC4'],
 ['duplicate device',s=>s.devices.push({...s.devices[0]})],
 ['duplicate native identity',s=>s.units.push({...s.units[0]})],
 ['duplicate claim',s=>s.crosswalk.claims.push({...s.crosswalk.claims[0]})],
 ['revocation',s=>s.crosswalk.claims[0].status='revoked'],
 ['serial replacement',s=>s.devices[0].device_serial='replacement'],
 ['resource epoch replacement',s=>s.epochs[0].epoch='c'.repeat(64)],
 ['missing native epoch',s=>s.crosswalk.nativeEpochs.shift()],
 ['provider association conflict',s=>s.matches.push({equipment_unit_id:s.units[0].id})],
])test(`cached and uncached decisions agree for ${name}`,async()=>{const s=await fixture();mutate(s);await compare(s);});
test('successive invocations reread changed labels, serials, epochs and revocations',async()=>{
 const s=await fixture();assert.equal((await compare(s)).result.unitIdentities.length,20);
 const extra={...s.units[0],id:uuid(500),unit_number:'Spotter800001HDC2'};s.units.push(extra);
 assert.equal((await compare(s)).result.unitIdentities.length,20);
 extra.unit_number='Spotter 900001HDC2';assert.equal((await compare(s)).result.unitIdentities.length,19);
 extra.unit_number='Spotter800001HDC2';assert.equal((await compare(s)).result.unitIdentities.length,20);
 s.devices[0].device_serial='replacement';assert.equal((await compare(s)).result.unitIdentities.length,19);
 s.devices[0].device_serial='serial-1';s.epochs[0].epoch='c'.repeat(64);assert.equal((await compare(s)).result.unitIdentities.length,19);
 s.epochs[0].epoch='a'.repeat(64);s.crosswalk.claims[0].status='revoked';assert.equal((await compare(s)).result.unitIdentities.length,19);
});
for(const [name,makeId,shouldBlock] of [
 ['string',()=>['provider','provider'],true],
 ['number',()=>[42,42],true],
 ['null',()=>[null,null],true],
 ['undefined',()=>[undefined,undefined],true],
 ['NaN',()=>[NaN,NaN],false],
 ['string versus number',()=>['42',42],false],
 ['distinct objects',()=>[{},{}],false],
 ['same object',()=>{const id={};return [id,id];},true],
])test(`provider membership retains strict equality for ${name}`,async()=>{
 const s=await fixture(),[matchId,providerId]=makeId();
 s.matches.push({vigilant_device_id:matchId});s.providers.push({id:providerId,external_device_id:s.devices[0].external_device_id,source:s.devices[0].source});
 const result=await compare(s);assert.equal(result.result.unitIdentities.length,shouldBlock?19:20);
});
test('duplicate provider IDs retain every provider and exact physical/source comparisons',async()=>{
 const s=await fixture(),d=s.devices[0];s.matches.push({vigilant_device_id:'provider'},{vigilant_device_id:'provider'});
 s.providers.push({id:'provider',source:d.source,external_device_id:'unrelated'},{id:'provider',source:d.source,external_device_id:d.external_device_id});
 assert.equal((await compare(s)).result.unitIdentities.length,19);
 s.providers[1].source='different-source';assert.equal((await compare(s)).result.unitIdentities.length,20);
 s.providers[1].source=d.source;assert.equal((await compare(s)).result.unitIdentities.length,19);
 s.matches.length=0;assert.equal((await compare(s)).result.unitIdentities.length,20);
});
test('physical serial and external-ID clashes remain quarantined',async()=>{
 for(const field of ['device_serial','external_device_id']){
  const s=await fixture();s.devices[1][field]=s.devices[0][field];
  assert.equal((await compare(s)).result.unitIdentities.length,18);
 }
});
