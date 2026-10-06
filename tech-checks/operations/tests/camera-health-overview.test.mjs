import assert from 'node:assert/strict';import test from 'node:test';import {readFileSync} from 'node:fs';import vm from 'node:vm';
const context=vm.createContext({Intl,Date});for(const file of ['camera-health-history.js','camera-health-overview.js'])vm.runInContext(readFileSync(new URL('../../'+file,import.meta.url),'utf8'),context);
const api=context.CameraHealthOverview,now=Date.parse('2026-10-06T16:10:00Z');
const device={source:'reconeyez',unit_key:'RII-028',source_metadata:{area:'Exact vendor area'}};
const event={id:1,external_device_id:'BRIDGE-1',component_guid:'BRIDGE-1',component_type:'bridge_4g',component_name:'Bridge A',component_area:'Exact vendor area',observed_at:'2026-10-06T16:00:00Z',event_type:'YC',battery_percent:7};
test('bridge mapping requires an exact unique provider area, no fuzzy names or fallback',()=>{
 assert.equal(api.mappedArea('RII-028',[device]),'Exact vendor area');assert.equal(api.mappedArea('RII-028',[{...device,source_metadata:{}}]),null);
 assert.equal(api.mappedArea('RII-028',[device,{...device,unit_key:'RII-029'}]),null);
 assert.equal(api.mappedArea('RII-028',[device,{...device,source_metadata:{area:'Exact vendor area renamed'}}]),null);
});
test('bridge observations use source event order and never arrival order',()=>{
 const value=api.component([event,{...event,id:9,observed_at:'2026-10-06T15:00:00Z',event_type:'RP'}],event.component_area,now);
 assert.equal(value.state,'offline');assert.equal(value.battery,7);assert.equal(value.type,'Bridge');assert.match(api.componentHtml(value),/Critical/);
 const moved={...event,id:2,observed_at:'2026-10-06T16:05:00Z',component_area:'Different unit'};assert.equal(api.component([event,moved],event.component_area,now),null);
});
test('stale, future, missing, invalid and conflicting evidence cannot claim current online',()=>{
 for(const time of ['2026-10-06T15:00:00Z','2030-01-01T00:00:00Z',null,'bad']){const value=api.component([{...event,event_type:'RP',observed_at:time}],event.component_area,now);assert.equal(value.state,'unknown')}
 assert.equal(api.component([event,{...event,id:2,event_type:'RP'}],event.component_area,now).state,'unknown');
 assert.equal(api.component([{...event,component_guid:'WRONG'}],event.component_area,now),null);
});
test('sirens stay distinct, detector rows are not used and absent battery is not zero',()=>{
 assert.equal(api.component([{...event,component_type:'siren_v1',battery_percent:null}],event.component_area,now).battery,null);
 assert.equal(api.component([{...event,component_type:'siren_v1'}],event.component_area,now).type,'Siren');
 assert.equal(api.component([{...event,component_type:'detector_hdr_xrl'}],event.component_area,now),null);
});
test('unit cards contain basic info only and escape provider text',()=>{
 const html=api.card({k:'UNIT <ONE>',state:'online',ds:[{organization:'Site <X>'}]},{effectiveHealth:()=> 'online',cameraGroup:()=> 'Reconeyez',isShop:()=>false});assert.match(html,/UNIT &lt;ONE&gt;/);assert.doesNotMatch(html,/time-history|send-root|Recent Status|Live Event|diagnostic-tabs/);assert.match(html,/View unit details/);
});
test('equal-time type or identity disagreement, invalid newer records and generic activity fail closed',()=>{
 for(const change of [{component_type:'siren_v1'},{component_guid:'WRONG'},{component_area:'Moved'}]){const value=api.component([event,{...event,id:2,...change}],event.component_area,now);assert.ok(value===null||value.state==='unknown')}
 for(const time of ['1970-01-01T00:00:00Z',null,'bad','2030-01-01T00:00:00Z']){const value=api.component([event,{...event,id:2,observed_at:time,event_type:'RP'}],event.component_area,now);assert.equal(value.state,'unknown')}
 for(const type of ['BA','CL','OP','Movement detected','unrecognized'])assert.equal(api.eventStatus(type),'unknown');
});
