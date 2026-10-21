import test from 'node:test';
import assert from 'node:assert/strict';
import {fieldProductFixture} from './fixtures/mhelp-field-health-fixtures.mjs';
import {mhelpFieldHealth} from '../src/mhelpFieldHealth.ts';
import {fieldProductEvidence,fieldProductEvidenceCsv} from '../src/fieldProductEvidence.ts';
import {fleetAddressHealth} from '../src/fleetStatusPins.ts';

test('a legacy name match cannot give a Product ID positive health or a green address pin',()=>{
 const f=fieldProductFixture();delete f.rows[0].camera.association;
 assert.equal(f.rows[0].cameraState,'online');
 const view=mhelpFieldHealth(f.upload,f.roster,f.rows,f.now),item=view.items[0];
 assert.equal(item.state,'unlinked');assert.equal(item.unitId,f.units[0].id);
 assert.equal(item.evidence.gap,'device_link_needed');assert.deepEqual(item.evidence.observations,[]);
 assert.equal(fleetAddressHealth(view.items,f.rows,'camera').get(item.productId),'unknown');
 assert.equal(view.total,7);assert.equal(Object.values(view.counts).reduce((a,b)=>a+b),7);
});
test('source observation times survive saved reads and distinguish stale failures from current outages',()=>{
 const f=fieldProductFixture(),view=mhelpFieldHealth(f.upload,f.roster,f.rows,f.now);
 const live=view.items[0].evidence,stale=view.items[2].evidence;
 assert.equal(live.gap,null);assert.equal(live.observations[0].observedAt,new Date(f.fresh).toISOString());
 assert.equal(stale.gap,'no_current_reading');assert.equal(stale.observations[0].fresh,false);
 assert.equal(stale.observations[0].currentState,'verifying');
 assert.equal(live.video,'not_verified');
 const old=structuredClone(f.rows[0]);old.camera.state='unknown';old.cameraState='unknown';
 old.camera.rows[0].evidence.status='offline';old.camera.rows[0].evidence.observedAt='2026-10-01T00:00:00Z';
 const evidence=fieldProductEvidence(old,'unverified',f.now);
 assert.equal(evidence.gap,'no_current_reading');assert.equal(evidence.observations[0].reportedStatus,'offline');
 assert.equal(evidence.observations[0].currentState,'verifying');
});
test('current inconclusive checks, absent device links, inactive and support remain different gaps',()=>{
 const f=fieldProductFixture(),row=structuredClone(f.rows[0]);
 row.camera.rows[0].evidence.status='unknown';
 assert.equal(fieldProductEvidence(row,'unverified',f.now).gap,'incomplete_check');
 const items=mhelpFieldHealth(f.upload,f.roster,f.rows,f.now).items;
 assert.equal(items[3].evidence.gap,'not_applicable');
 assert.equal(items[4].evidence.gap,'device_link_needed');
 assert.equal(items[5].evidence.gap,'device_link_needed');
 assert.equal(items[6].evidence.gap,'inactive');
});
test('mixed Recon detectors keep every resource and observation separately; bridge contact is not a detector check',()=>{
 const f=fieldProductFixture(),row=structuredClone(f.rows[0]);
 row.camera.association.kind='reconeyez_area';row.camera.basis='camera';
 row.camera.rows=[1,2].map((id,i)=>({id,unit:'RII009',type:'Reconeyez detector',status:'review',evidence:{kind:'provider',source:'Reconeyez',resource:'detector',active:true,status:i?'unknown':'online',observedAt:f.fresh,lastOnlineAt:null}}));
 const e=fieldProductEvidence(row,'unverified',f.now);
 assert.equal(e.gap,'incomplete_check');assert.equal(e.observations.length,2);
 assert.deepEqual(e.observations.map(o=>o.kind),['detector','detector']);
 assert.equal(e.association,'reconeyez_area');assert.equal(e.video,'not_verified');
});

test('the audit exports each Field Product ID once, preserves suffixes and source times, and neutralizes formulas',()=>{
 const f=fieldProductFixture(),view=mhelpFieldHealth(f.upload,f.roster,f.rows,f.now);
 view.items[0].unitNumber='Spotter 022HDC1';view.items[1].unitNumber='=not-a-formula';
 const csv=fieldProductEvidenceCsv(view.items,view.sourceSha256,view.receivedAt);
 assert.equal(csv.split('\r\n').length,8);assert.match(csv,/Spotter 022HDC1/);assert.match(csv,/"'=not-a-formula"/);
 assert.match(csv,new RegExp(new Date(f.fresh).toISOString()));
 assert.throws(()=>fieldProductEvidenceCsv([...view.items,view.items[0]],view.sourceSha256,view.receivedAt),/invalid/);
});
