import test from 'node:test';
import assert from 'node:assert/strict';
import {tvMapTour,tvOutageRows,tvCameraPageSize} from '../src/tvMapTour.ts';
import {configuredTvPages} from '../src/tvBoardData.ts';
import {checkedTvSettings,checkedTvRotationSeconds,tvTimingSaveRevision} from '../../supabase/functions/cos-operations-pages/tv-board-settings/index.ts';
const row=(id,latitude,longitude,state)=>({unit:{id,unitNumber:id},health:{state},point:{latitude,longitude}});

test('map close-ups cover every located unit and put outage areas ahead of healthy areas',()=>{
 const rows=[row('Houston green',29.76,-95.37,'online'),row('Houston red',29.77,-95.36,'offline'),row('Dallas green',32.77,-96.79,'online'),row('Austin unknown',30.26,-97.74,'unknown')];
 const areas=tvMapTour(rows),closeups=areas.slice(1);
 assert.equal(areas[0].kind,'overview');assert.equal(areas[0].ids.length,4);
 assert.deepEqual(closeups.flatMap(area=>area.ids).sort(),rows.map(row=>row.unit.id).sort());
 assert.equal(closeups.length,3);assert.equal(closeups[0].offline,1);assert.equal(closeups[0].online,1);assert.match(closeups[0].label,/Houston red/);
 assert.deepEqual(tvMapTour([...rows].reverse()),areas);
});
test('long chains of nearby units cannot turn a close-up into a statewide view',()=>{
 const areas=tvMapTour(Array.from({length:12},(_,index)=>row('Unit '+index,30,-97+index*.12,'online'))).slice(1);
 assert.ok(areas.length>1);
 for(const area of areas)assert.ok(Math.max(...area.points.map(p=>p.longitude))-Math.min(...area.points.map(p=>p.longitude))<.3);
 assert.equal(areas.flatMap(area=>area.ids).length,12);
});
test('unknown health is never promoted to red and locations are never invented',()=>{
 const rows=[row('red',30,-97,'offline'),row('unknown',NaN,-97,'unknown'),row('green',30.1,-97,'online'),row('support',30.1,-97,'support')];
 assert.deepEqual(tvOutageRows(rows).map(row=>row.unit.id),['red']);
 assert.equal(tvMapTour(rows)[0].ids.includes('unknown'),false);
 assert.deepEqual(tvMapTour([]),[{kind:'overview',label:'All field units',ids:[],points:[],offline:0,online:0}]);
});
test('each outage page and each map area participates in the normal page rotation',()=>{
 const pages=configuredTvPages([],[],[],['camera','map'],1440,900,'2026-10-12',{camera:3,map:['All field units','Houston','Dallas']});
 assert.deepEqual(pages.map(page=>[page.kind,page.fleetPage]),[['camera',0],['camera',1],['camera',2],['map',0],['map',1],['map',2]]);
 assert.equal(tvCameraPageSize(390,844),1);assert.equal(tvCameraPageSize(1440,900),4);assert.equal(tvCameraPageSize(1920,1080),6);
});
test('rotation timing is bounded and older saved selections keep their 15-second default',()=>{
 for(const seconds of [5,15,30,60,300])assert.equal(checkedTvRotationSeconds(seconds),seconds);
 for(const seconds of [null,undefined,4,301,15.5,'30',NaN])assert.throws(()=>checkedTvRotationSeconds(seconds));
 assert.equal(checkedTvSettings({sections:['map'],revision:2,updatedAt:null}).rotationSeconds,15);
 assert.equal(checkedTvSettings({sections:['map'],revision:2,updatedAt:null,rotationSeconds:60}).rotationSeconds,60);
 assert.equal(tvTimingSaveRevision(4,30),1000004030);
 assert.ok(tvTimingSaveRevision(1147483,300)<=2147483647);
 for(const revision of [-1,1.5,1147484])assert.throws(()=>tvTimingSaveRevision(revision,30));
});
