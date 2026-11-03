import {test} from 'node:test';
import assert from 'node:assert/strict';
import {matchesEquipment,equipmentEligible,equipmentHold} from '../../transfers/equipment-search.js';
const solar={equipment_key:'solar_spotter:53',unit_name:'Solar Spotter 053',family:'Solar Spotter',unit_tag:'053',supported:true,tracker_state:'shop'};
test('number padding, compact names and keywords filter without changing identities',()=>{
 for(const q of ['053','53','SolarSpotter053','solar spotter 53','SPOTTER',' solar '])assert.equal(matchesEquipment(solar,q),true,q);
 for(const q of ['5','530','Sniper53','054','???'])assert.equal(matchesEquipment(solar,q),false,q);
 assert.equal(matchesEquipment(solar,''),true);assert.equal(matchesEquipment({...solar,unit_tag:'153',unit_name:'Solar Spotter153',equipment_key:'solar_spotter:153'},'53'),false);
 assert.equal(matchesEquipment({...solar,family:'Sniper',unit_name:'Sniper053',equipment_key:'sniper:53'},'SolarSpotter053'),false);
});
test('search never overrides any eligibility hold',()=>{
 assert.equal(equipmentEligible(solar),true);
 for(const delta of [{reserved:true},{supported:false},{tracker_state:'field'},{tracker_state:'unknown'},{hold_reason:'Native binding missing'}]){
 const item={...solar,...delta};assert.equal(matchesEquipment(item,'53'),true);assert.equal(equipmentEligible(item),false);assert.ok(equipmentHold(item));
 }
});
