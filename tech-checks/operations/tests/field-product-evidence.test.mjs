import test from 'node:test';
import assert from 'node:assert/strict';
import {fieldProductFixture} from './fixtures/mhelp-field-health-fixtures.mjs';
import {mhelpFieldHealth} from '../src/mhelpFieldHealth.ts';
import {fieldProductEvidence,fieldProductEvidenceCsv} from '../src/fieldProductEvidence.ts';
import {fleetAddressHealth} from '../src/fleetStatusPins.ts';
import {buildExactProductConnections,VERIFIED_TRACKER_IP_CONTRACT,TRACKER_IP_WORKBOOK} from '../src/exactProductConnection.ts';

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

test('IP-only TCP response cannot certify an unlinked product or unassociated native row',()=>{
 const f=fieldProductFixture();
 delete f.rows[0].camera.association;
 const tracker={contract:VERIFIED_TRACKER_IP_CONTRACT,workbookId:TRACKER_IP_WORKBOOK,
  expectedMhelpSourceSha256:f.upload.sourceSha256,verifiedAt:f.fresh,
  records:f.upload.records.map(product=>({productId:product.productId,recordId:product.recordId,placement:product.placement,
   publicIp:product.productId==='1001'?'8.8.8.8':product.productId==='1005'?'9.9.9.9':product.productId==='1004'?'4.2.2.2':null}))};
 const device=(id,ip,online)=>({deviceId:id,publicIp:ip,expectedPorts:[80,443],connectionRevision:2,monitoringEnabled:true,
  portStatus:{80:{online,attempted:true},443:{online:false,attempted:true},
   _connection:{ip,revision:2,checkedAt:f.fresh,status:online?'online':'offline',reachable:online,consecutiveFailures:1,confirmedOutage:false}}});
 const exact=buildExactProductConnections(f.upload,tracker,[device(881,'8.8.8.8',true),device(882,'9.9.9.9',false),device(883,'4.2.2.2',true)],f.now);
 assert.ok(exact);
 const view=mhelpFieldHealth(f.upload,f.roster,f.rows,f.now,exact);
 assert.equal(view.items[0].state,'unverified');assert.equal(view.items[0].evidence.association,'exact_product_id_tracker_endpoint');
 assert.equal(view.items[0].evidence.observations.length,0);
 assert.match(view.items[0].reason,/Product-to-resource membership/);
 assert.equal(view.items[0].evidence.video,'not_verified');
 assert.equal(view.items[3].state,'support');
 assert.equal(view.items[4].state,'unverified');assert.equal(view.items[4].evidence.basis,'connection');
 assert.equal(view.items[4].evidence.observations.length,0);
 assert.equal(view.items[5].state,'review');assert.equal(view.items[6].state,'inactive');
 assert.equal(view.total,7);assert.equal(Object.values(view.counts).reduce((sum,v)=>sum+v,0),7);
 assert.equal(fleetAddressHealth(view.items,f.rows,'camera').get('1005'),'unknown');
});
test('unverified or wrong-source TCP receipts never bypass a missing provider association',()=>{
 const f=fieldProductFixture();delete f.rows[0].camera.association;
 const fake={contract:'COS_EXACT_PRODUCT_CONNECTIONS_V2',sourceSha256:'b'.repeat(64),trackerVerifiedAt:f.fresh,
  items:f.upload.records.filter(p=>p.placement==='FIELD').map(p=>({productId:p.productId,status:'online',basis:'tcp_service_port',resourceId:'881',checkedAt:f.fresh,reason:'fake'}))};
 assert.equal(mhelpFieldHealth(f.upload,f.roster,f.rows,f.now,fake).items[0].state,'unverified');
});

test('an Unknown Product-ID TCP check falls back to labelled provider health only on a reviewed association',()=>{
 // Owner intent: a direct check and the provider's own report are two separate
 // signals. Where no direct result exists, a REVIEWED device association may
 // show the provider's status, always labelled and never silently. Equipment
 // without a reviewed association, and stale provider data, stay Unknown.
 const f=fieldProductFixture();
 const receipt={contract:'COS_EXACT_PRODUCT_CONNECTIONS_V2',
  sourceSha256:f.upload.sourceSha256,trackerVerifiedAt:f.fresh,
  items:f.upload.records.filter(r=>r.placement==='FIELD').map(r=>({
   productId:r.productId,basis:'tcp_service_port',status:'unknown',checkedAt:null,
   resourceId:null,reason:'No complete current tracker-IP check.'
  }))};
 const view=mhelpFieldHealth(f.upload,f.roster,f.rows,f.now,receipt);
 assert.equal(f.rows[0].cameraState,'online');
 assert.equal(f.rows[1].cameraState,'offline');
 assert.equal(view.items[0].state,'online');
 assert.equal(view.items[1].state,'offline');
 // The label and the missing direct result both stay on the record.
 assert.match(view.items[0].reason,/Provider-reported, not direct-connection verified/);
 assert.match(view.items[0].reason,/No complete current tracker-IP check/);
 assert.equal(view.items[0].evidence.association,'native_provider');
 assert.equal(view.counts.online,1);
 assert.equal(view.counts.offline,1);
 // Stale provider observations are still not a status.
 assert.equal(view.items[2].state,'unverified');
 // No COS unit record at all: unchanged, never promoted.
 assert.equal(view.items[4].state,'unverified');
 assert.equal(view.items[3].state,'support');
 assert.equal(view.items[5].state,'review');
 assert.equal(view.items[6].state,'inactive');
 assert.equal(Object.values(view.counts).reduce((sum,v)=>sum+v,0),7);
});

test('an unavailable TCP source still reports provider health, labelled, and never hides the source failure',()=>{
 const f=fieldProductFixture();
 const view=mhelpFieldHealth(f.upload,f.roster,f.rows,f.now,null);
 assert.equal(view.counts.online,1);assert.equal(view.counts.offline,1);
 assert.equal(view.items[0].state,'online');assert.equal(view.items[1].state,'offline');
 assert.match(view.items[0].reason,/Provider-reported, not direct-connection verified/);
 // The unreadable connection source is still raised for IT, not swallowed.
 assert.equal(view.items[0].evidence.followUp.category,'source_unavailable');
 // Equipment with no reviewed unit association stays Unknown with its own diagnostics.
 assert.equal(view.items[2].state,'unverified');
 assert.equal(view.items[4].state,'unverified');
 assert.equal(view.items[4].evidence.association,'product_id_connection_unavailable');
 assert.equal(view.items[4].evidence.observedAt,null);assert.deepEqual(view.items[4].evidence.observations,[]);
 assert.equal(view.items[3].state,'support');assert.equal(view.items[5].state,'review');assert.equal(view.items[6].state,'inactive');
 // An older/native-only source never requesting Product-ID proof retains its existing diagnostics.
 assert.equal(mhelpFieldHealth(f.upload,f.roster,f.rows,f.now).items[0].state,'online');
});
