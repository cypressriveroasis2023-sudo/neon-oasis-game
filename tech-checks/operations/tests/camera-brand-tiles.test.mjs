import {test} from 'node:test';
import assert from 'node:assert/strict';
import {familyBoardCounts,familyFieldCounts,familyOf,groupedUnits,FAMILY_LABEL} from '../src/cameraStatusFilters.ts';

const unit=(name,placement='FIELD',state='GREEN',extra={})=>
 ({unit:name,displayName:name,placement,state,site:'',address:'',publicIp:'',...extra});

test('the three makes COS carries are counted apart', () => {
 const units=[unit('SNIPER 302'),unit('CAM V 010'),unit('RECON II 025'),
              unit('SOLAR SPOTTER 021'),unit('SOLAR STAND 031')];
 assert.deepEqual(familyFieldCounts(units),{avigilon:2,recon:1,alibi:2});
});

test('shop units never count toward a make in the field', () => {
 const units=[unit('SNIPER 302'),unit('SNIPER 208','SHOP'),unit('RECON II 025','SHOP')];
 assert.deepEqual(familyFieldCounts(units),{avigilon:1,recon:0,alibi:0});
 assert.deepEqual(familyBoardCounts(units),{avigilon:2,recon:1,alibi:0});
});

test('the brand counts add up to the field total', () => {
 const units=[unit('SNIPER 302'),unit('RECON II 025'),unit('SOLAR STAND 031'),unit('ST 044','SHOP')];
 const counts=familyFieldCounts(units);
 const field=units.filter(u=>u.placement==='FIELD').length;
 assert.equal(counts.avigilon+counts.recon+counts.alibi,field);
});

test('a brand tile narrows the list to that make only', () => {
 const units=[unit('SNIPER 302'),unit('CAM V 010'),unit('RECON II 025'),unit('SOLAR SPOTTER 021')];
 const shown=groupedUnits(units,'field','','all','avigilon');
 assert.deepEqual(shown.map(u=>u.unit),['SNIPER 302','CAM V 010']);
});

test('a site or address containing a make name is not that make', () => {
 // The make is read off the unit name, never off the typed text.
 const decoy=unit('SOLAR SPOTTER 021',undefined,undefined,{site:'Alibi Road Depot'});
 const shown=groupedUnits([decoy,unit('RECON II 025')],'field','','all','recon');
 assert.deepEqual(shown.map(u=>u.unit),['RECON II 025']);
 assert.equal(familyOf(decoy),'alibi');
});

test('no make filter leaves every field unit shown', () => {
 const units=[unit('SNIPER 302'),unit('RECON II 025'),unit('SOLAR STAND 031')];
 assert.equal(groupedUnits(units,'field','','all','all').length,3);
 assert.equal(groupedUnits(units,'field','','all').length,3);
});

test('a make and a state narrow together, not one or the other', () => {
 const units=[unit('SNIPER 302'),unit('SNIPER 208',undefined,'RED'),unit('RECON II 025',undefined,'RED')];
 const down=groupedUnits(units,'field','','RED','avigilon');
 assert.deepEqual(down.map(u=>u.unit),['SNIPER 208']);
});

test('every make has a label for the tile', () => {
 assert.deepEqual(Object.keys(FAMILY_LABEL).sort(),['alibi','avigilon','recon']);
 assert.equal(FAMILY_LABEL.recon,'Recon II');
});
