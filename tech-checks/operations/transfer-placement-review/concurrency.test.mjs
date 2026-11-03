import test from 'node:test';import assert from 'node:assert/strict';import {readFile} from 'node:fs/promises';
import {RealPostgres} from '../shared-snapshot-review/real-postgres-fixture.mjs';
const quote=v=>"'"+(typeof v==='object'?JSON.stringify(v):String(v)).replaceAll("'","''")+"'";
const it='00000000-0000-4000-8000-000000000001',svc='00000000-0000-4000-8000-000000000002',other='00000000-0000-4000-8000-000000000003',unverified='00000000-0000-4000-8000-000000000004';
test('real PostgreSQL concurrent publication and signed checkout serialize without stale placement admission',async()=>{
 const db=new RealPostgres();try{
  const fixture=await readFile(new URL('../tests/transfer-purpose.test.mjs',import.meta.url),'utf8');
  let setup=fixture.split('await db.exec(`')[1].split('`);')[0];for(const [k,v] of Object.entries({it,svc,other,unverified}))setup=setup.replaceAll('${'+k+'}',v);
  await db.exec(setup);
  for(const name of ['techcheck-named-handoffs-v1.sql','techcheck-transfer-rollout-v2.sql','techcheck-transfer-integration-v3.sql','techcheck-transfer-purpose-v2.sql'])await db.exec(await readFile(new URL('../../database-maintenance/'+name,import.meta.url),'utf8'));
  await db.exec("update app_private.techcheck_transfer_settings set enabled=true,reports_ready=true,receipt_link_ready=true,custody_ready=true;insert into equipment_master values('solar_spotter:53','53','Solar Spotter','Solar Spotter','Solar Spotter','Synthetic Solar Spotter 53','field_or_unknown',now())");
  for(const file of ['storage.sql','wiring.sql'])await db.exec(await readFile(new URL(file,import.meta.url),'utf8'));
  const packet={source_sha:'a'.repeat(64),crosswalk_sha:'b'.repeat(64),saved_at:new Date().toISOString(),rows:[{equipment_key:'solar_spotter:53',product_id:'9001',native_unit_id:'00000000-0000-4000-8000-000000000099',family:'Solar Spotter',unit_tag:'53',placement:'SHOP',eligible:true,binding_guard:'c'.repeat(64)}]};
  const publish=(g,p)=>`set role service_role;set test.jwt_role='service_role';select public.cos_admit_transfer_placement_v1(${g},${quote(p)}::jsonb);`;
  await db.raw(db.name,publish(0,packet));
  const proof=(await db.query("select app_private.techcheck_placement_evidence_v1('solar_spotter:53') proof")).rows[0].proof;
  const id='00000000-0000-4000-8000-000000000090',path=it+'/'+id+'/'+'a'.repeat(64)+'.jpg';
  await db.exec(`insert into storage.objects values('techcheck-transfer-evidence',${quote(path)},'{"mimetype":"image/jpeg","size":1234}')`);
  const contract=JSON.parse(await readFile(new URL('../../transfers/checklist-contract.json',import.meta.url),'utf8'));
  const checks=Object.fromEntries([...contract.families['Solar Spotter'].bool_fields,'delivery_monitoring_ok','delivery_ticket_count_ok','delivery_customer_email_app_ok'].map(k=>[k,true]));
  const item={equipment_key:'solar_spotter:53',family:'Solar Spotter',unit_tag:'53',sims:['00123456789012345670'],battery_count:4,battery_configuration:'agm_4x_12v_110ah',parts:[],placement_evidence:proof};
  const call=`set role authenticated;set test.actor=${quote(it)};select public.submit_techcheck_transfer_v2(${quote(id)}::uuid,${quote(id)}::uuid,'checkout',0,${quote(svc)}::uuid,${quote([item])}::jsonb,${quote({'solar_spotter:53':checks})}::jsonb,${quote({method:'typed',name:'Synthetic IT',confirmed:true})}::jsonb,${quote([{equipment_key:item.equipment_key,kind:'unit',path}])}::jsonb,'Synthetic only','installation');`;
  // Publisher holds the same lock used by real guarded submission. Its newly
  // admitted Field source must be visible after the waiting checkout resumes.
  const field=structuredClone(packet);field.rows[0].placement='FIELD';field.rows[0].eligible=false;field.crosswalk_sha='d'.repeat(64);
  const publishing=db.raw(db.name,'begin;'+publish(1,field)+'select pg_sleep(1);commit;');
  let seen=false;for(let i=0;i<100;i++){const locks=await db.query("select count(*)::int n from pg_locks where locktype='advisory' and classid=724091 and objid=1 and granted and mode='ExclusiveLock'");if(locks.rows[0].n){seen=true;break;}await new Promise(r=>setTimeout(r,10));}
  assert.ok(seen,'observe actual publication lock before starting checkout');
  await assert.rejects(db.raw(db.name,call),/verified Shop/);await publishing;
  assert.equal((await db.query('select count(*)::int n from app_private.techcheck_transfer_events')).rows[0].n,0);
  packet.crosswalk_sha='e'.repeat(64);await db.raw(db.name,publish(2,packet));
  const fresh=(await db.query("select app_private.techcheck_placement_evidence_v1('solar_spotter:53') proof")).rows[0].proof;
  const currentItem={...item,placement_evidence:fresh};
  const signing=db.raw(db.name,'begin;'+call.replace(quote([item]),quote([currentItem]))+'select pg_sleep(1);commit;');
  seen=false;for(let i=0;i<100;i++){const locks=await db.query("select count(*)::int n from pg_locks where locktype='advisory' and classid=724091 and objid=1 and granted and mode='ShareLock'");if(locks.rows[0].n){seen=true;break;}await new Promise(r=>setTimeout(r,10));}
  assert.ok(seen,'checkout holds source lock until its signed event commits');
  const next=db.raw(db.name,publish(3,field));await signing;await next;
  const saved=(await db.query('select snapshot from app_private.techcheck_transfer_events')).rows;
  assert.equal(saved.length,1);assert.equal(saved[0].snapshot.placement_evidence[0].generation,3);
  assert.equal(saved[0].snapshot.signature.signed_by,it);

 }finally{await db.close();}
});
