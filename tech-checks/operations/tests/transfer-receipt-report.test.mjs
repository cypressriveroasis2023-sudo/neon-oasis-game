import {test} from 'node:test';
import assert from 'node:assert/strict';
import {summaryHtml, summaryPdf, reportHtml} from '../../supabase/functions/techcheck-transfer-delivery/report.ts';
const pdfText=r=>[...new TextDecoder().decode(summaryPdf(r)).matchAll(/\(((?:\\.|[^\\)])*)\) Tj/g)].map(match=>match[1].replace(/\\([\\()])/g,'$1')).join(' ');

function report(purpose, item={}) {
  return {id:'00000000-0000-4000-8000-000000000333',kind:'receipt',actor_name:'Synthetic Service',check_date:'2026-10-22',submitted_at:'2026-10-22T14:00:00Z',photos:[],snapshot:{
    transfer_id:'00000000-0000-4000-8000-000000000222',state:'accepted',revision:2,purpose,
    it_name:'Synthetic IT',service_name:'Synthetic Service',expected:[],actual:[{equipment_key:'solar_spotter:001',family:'Solar Spotter',unit_tag:'001',sims:[],battery_count:null,parts:[],...item}],
    checks:{},differences:[],notes:'Synthetic verification only',signature:{method:'typed',name:'Synthetic Service',signed_at:'2026-10-22T14:00:00Z',statement:'I confirm I received the equipment listed.'}
  }};
}
test('truck replenishment email and signed paperwork make the separate battery count explicit',()=>{
  const r=report('truck_replenishment');
  for(const content of [summaryHtml(r,'folder','pdf'),reportHtml(r),pdfText(r)]){
    assert.match(content,/Truck replenishment/);
    assert.match(content,/counted separately/);
    assert.doesNotMatch(content,/Batteries(?: recorded)?: (?:0|null|undefined)/);
  }
  assert.equal(r.snapshot.actual[0].battery_count,null);
});
test('installation paperwork retains the explicit battery setup and required quantity',()=>{
  const r=report('installation',{battery_count:4,battery_configuration:'agm_4x_12v_110ah',required_battery_count:4});
  for(const content of [reportHtml(r),pdfText(r)]){
    assert.match(content,/Installation/);
    assert.match(content,/4 x 12V 110Ah batteries per Solar Stand/);
    assert.match(content,/Batteries recorded: 4/);
    assert.match(content,/Required: 4/);
    assert.match(content,/does not complete/);
    assert.match(content,/the installation/);
  }
  const ranger=report('installation',{family:'Ranger',battery_count:1,battery_configuration:'lifepo4_1x',required_battery_count:1});
  assert.match(reportHtml(ranger),/1 LiFePO4 battery/);
  assert.doesNotMatch(reportHtml(ranger),/LiTime|110Ah/);
});
test('historical purpose and battery values stay explicit instead of silently becoming replenishment',()=>{
  const r=report(undefined,{battery_count:1});
  const before=JSON.stringify(r);
  assert.match(reportHtml(r),/Purpose not recorded in this original handoff/);
  assert.match(reportHtml(r),/Batteries recorded: 1/);
  summaryHtml(r,'folder','pdf');summaryPdf(r);
  assert.equal(JSON.stringify(r),before);
});
test('purpose amendment records its real actor without manufacturing a Service signature',()=>{
  const r=report('truck_replenishment');r.kind='purpose_amendment';r.snapshot.state='awaiting_service';
  delete r.snapshot.signature;
  Object.assign(r.snapshot,{applied_by:{id:'owner-id',name:'Synthetic Owner',role:'owner'},recorded_at:r.submitted_at,statement:'Original signed records remain unchanged. The named Service technician must independently confirm receipt.',original_event_id:'original-event',previous_revision:5,previous_state:'discrepancy',notes:'Truck spare handoff clarified by Owner.'});
  for(const content of [summaryHtml(r,'folder','pdf'),reportHtml(r),pdfText(r)]){
    assert.match(content,/Handoff Purpose Updated/);
    assert.match(content,/RECORDED BY Synthetic Owner|Recorded by Synthetic Owner/);
    assert.match(content,/independently confirm receipt/);
    assert.doesNotMatch(content,/Signed by|SIGNED BY|undefined/);
  }
  assert.match(reportHtml(r),/Original handoff event original-event/);
  assert.equal(r.snapshot.signature,undefined);
});
test('original photo attribution names its IT source while the receiving technician signs independently',()=>{
  const r=report('truck_replenishment');
  r.snapshot.original_evidence=[{equipment_key:'solar_spotter:001',source_actor_name:'Synthetic IT',source_signed_at:'2026-10-21T12:00:00Z',source_event_id:'original-event'}];
  for(const content of [reportHtml(r),pdfText(r)]){
    assert.match(content,/Original IT checkout photo for solar_spotter:001/);
    assert.match(content,/recorded by Synthetic IT/);
    assert.match(content,/Source event original-event/);
    assert.match(content,/not a new Service photo/);
    assert.match(content,/SIGNED BY Synthetic Service|Signed by Synthetic Service/);
  }
});
