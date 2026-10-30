import test from 'node:test';
import assert from 'node:assert/strict';
import {fieldProductFollowUp} from '../src/fieldProductFollowUp.ts';
import {mhelpFieldHealth} from '../src/mhelpFieldHealth.ts';
import {fieldProductEvidenceCsv} from '../src/fieldProductEvidence.ts';
import {fieldProductFixture} from './fixtures/mhelp-field-health-fixtures.mjs';

const sourceHold='Current tracker and mHelp source disagree for this Product ID. Placement or identity review is required; no connection status is assigned.';
const missingIp='No verified public tracker IP is available for this Product ID.';
const savedCheck='No fresh, completed, exact-target TCP/service-port check is available.';
const item=(view,id)=>view.items.find(row=>row.productId===id);
const setReason=(fixture,id,reason)=>{fixture.connections.items.find(row=>row.productId===id).reason=reason;};
const build=fixture=>mhelpFieldHealth(fixture.upload,fixture.roster,fixture.rows,fixture.now,fixture.connections);

test('known Unknown reasons identify the responsible role without guessing a more specific failure',()=>{
 const cases=[
  [sourceHold,'source_review','Owner'],
  ['Equipment identity or placement is held for review.','source_review','Owner'],
  [missingIp,'tracker_ip','IT'],
  ['Another Product ID claims this tracker IP; verify endpoint ownership.','endpoint_ownership','IT and Owner'],
  ['More than one saved endpoint claims this tracker IP; verify exact device ownership.','endpoint_ownership','IT and Owner'],
  ['No saved camera endpoint matches the current tracker IP.','saved_endpoint','IT'],
  [savedCheck,'saved_check','IT'],
  ['The exact Product-ID TCP source is unavailable, stale or does not match the current inventory. Connection status is Unknown.','source_unavailable','IT']
 ];
 for(const [reason,category,role] of cases){
  const followUp=fieldProductFollowUp('unverified',reason);
  assert.equal(followUp.category,category);assert.equal(followUp.responsibleRole,role);
  assert.ok(followUp.label.length&&followUp.nextStep.length);
 }
 const genericCheck=fieldProductFollowUp('unverified',savedCheck);
 assert.match(genericCheck.nextStep,/more specific cause has not been established/);
 assert.doesNotMatch(genericCheck.nextStep,/routing error|stale check|wrong IP|monitoring disabled/i);
});

test('follow-up guidance leaves product health, counts, timestamps and source records unchanged',()=>{
 const f=fieldProductFixture();setReason(f,'1003',missingIp);setReason(f,'1005',savedCheck);
 const sources=structuredClone([f.upload,f.roster,f.rows,f.connections]);
 const view=build(f);
 assert.deepEqual(view.counts,{online:1,offline:1,unverified:2,support:1,unlinked:0,review:1,inactive:1});
 assert.equal(view.total,7);
 for(const id of ['1001','1002']){
  assert.equal(item(view,id).evidence.followUp,undefined);
  assert.equal(item(view,id).evidence.observedAt,f.fresh);
 }
 assert.equal(item(view,'1003').state,'unverified');
 assert.equal(item(view,'1003').evidence.followUp.category,'tracker_ip');
 assert.equal(item(view,'1005').evidence.followUp.category,'saved_check');
 assert.equal(item(view,'1003').evidence.observedAt,null);
 assert.deepEqual(item(view,'1003').evidence.observations,[]);
 assert.equal(item(view,'1006').evidence.followUp.responsibleRole,'Owner');
 assert.equal(item(view,'1007').evidence.followUp.category,'lifecycle_review');
 assert.deepEqual([f.upload,f.roster,f.rows,f.connections],sources);
});

test('an explicit source hold remains visible on support without adding a camera outage or Unknown camera',()=>{
 const f=fieldProductFixture();const before=build(f);setReason(f,'1004',sourceHold);
 const view=build(f),support=item(view,'1004');
 assert.equal(support.state,'support');assert.equal(support.evidence.gap,'not_applicable');
 assert.equal(support.evidence.followUp.category,'source_review');
 assert.equal(support.evidence.followUp.responsibleRole,'Owner');
 assert.deepEqual(view.counts,before.counts);
 assert.deepEqual(support.evidence.observations,[]);
 setReason(f,'1004',missingIp);
 assert.equal(item(build(f),'1004').evidence.followUp,undefined);
 setReason(f,'1004',savedCheck);
 assert.equal(item(build(f),'1004').evidence.followUp,undefined);
});

test('a failed source receipt never creates support work and never hides the source-read failure',()=>{
 const f=fieldProductFixture();setReason(f,'1004',sourceHold);
 f.connections.sourceSha256='b'.repeat(64);
 const view=build(f);
 assert.equal(item(view,'1004').state,'support');
 assert.equal(item(view,'1004').evidence.followUp,undefined);
 // The reviewed association now reports the provider's own status, labelled,
 // but the unreadable connection source is still raised for IT.
 assert.equal(item(view,'1001').state,'online');
 assert.match(item(view,'1001').reason,/Provider-reported, not direct-connection verified/);
 assert.equal(item(view,'1001').evidence.followUp.category,'source_unavailable');
 // Equipment with no reviewed unit association stays Unknown and keeps its guidance.
 assert.equal(item(view,'1005').state,'unverified');
 assert.equal(item(view,'1005').evidence.followUp.category,'source_unavailable');
 assert.equal(item(view,'1005').evidence.observedAt,null);
 assert.deepEqual(item(view,'1005').evidence.observations,[]);
});

test('unknown text and object-property names get neutral guidance rather than an invented diagnosis',()=>{
 for(const reason of ['constructor','__proto__','toString','Arbitrary text claiming a router failed']){
  const followUp=fieldProductFollowUp('unverified',reason);
  assert.equal(followUp.category,'evidence_review');
  assert.match(followUp.nextStep,/more specific cause has not been established/);
  assert.doesNotMatch(followUp.nextStep,/router failed/);
  assert.equal(fieldProductFollowUp('support',reason,reason),null);
 }
 assert.equal(fieldProductFollowUp('online',missingIp),null);
 assert.equal(fieldProductFollowUp('offline',sourceHold),null);
 assert.equal(fieldProductFollowUp('unexpected',sourceHold),null);
 assert.equal(fieldProductFollowUp('unlinked','No verified COS health link.').category,'device_link');
});

test('the existing CSV gains guidance without losing status, source times, one-row-per-product or formula protection',()=>{
 const f=fieldProductFixture();setReason(f,'1003',missingIp);setReason(f,'1004',sourceHold);
 const view=build(f);item(view,'1003').unitNumber='=unsafe-label';
 const csv=fieldProductEvidenceCsv(view.items,view.sourceSha256,view.receivedAt);
 assert.equal(csv.split('\r\n').length,8);
 assert.match(csv.split('\r\n')[0],/Power telemetry,Follow-up category,Responsible role,Next step$/);
 assert.match(csv,/"'=unsafe-label"/);
 assert.match(csv,/Tracker IP not verified/);assert.match(csv,/Source records need review/);
 assert.match(csv,/"IT"/);assert.match(csv,/"Owner"/);
 assert.ok(csv.includes(f.fresh));
 assert.equal(item(view,'1004').state,'support');
 assert.throws(()=>fieldProductEvidenceCsv([...view.items,view.items[0]],view.sourceSha256,view.receivedAt),/invalid/);
});
