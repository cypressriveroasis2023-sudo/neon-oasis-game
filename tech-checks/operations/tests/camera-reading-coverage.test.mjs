import {test} from 'node:test';
import assert from 'node:assert/strict';
import {cameraReadingCoverage} from '../src/cameraReadingCoverage.ts';
const row=(source,observedAt,placement='FIELD',state='GREEN')=>({unit:'test',source,observedAt,placement,state});
test('source coverage keeps sources separate and excludes Shop',()=>{
 const data=[row(undefined,'2026-11-15T12:00:00Z'),row('ip_check','2026-11-15T13:00:00Z'),row('reconeyez',null),row('ip_check','2026-11-15T14:00:00Z','SHOP')];
 const copy=JSON.stringify(data),out=cameraReadingCoverage(data);
 assert.deepEqual(out.map(x=>x.field),[1,1,1]);assert.equal(out[0].newest,'2026-11-15T12:00:00.000Z');
 assert.equal(out[1].newest,'2026-11-15T13:00:00.000Z');assert.equal(out[2].newest,null);assert.equal(JSON.stringify(data),copy);
});
test('oldest and newest are observations, not request or feed times',()=>{
 const out=cameraReadingCoverage([row('ip_check','2026-11-15T13:00:00-06:00'),row('ip_check','2026-11-15T17:00:00Z')])[1];
 assert.equal(out.oldest,'2026-11-15T17:00:00.000Z');assert.equal(out.newest,'2026-11-15T19:00:00.000Z');
});
test('missing and invalid times remain unknown, not offline',()=>{
 const out=cameraReadingCoverage([row('reconeyez',null,'FIELD','UNKNOWN'),row('reconeyez','invalid')])[2];
 assert.equal(out.missingTime,2);assert.equal(out.oldest,null);assert.equal(out.unknown,1);
});
test('empty sources are explicitly represented without fabricated timestamps',()=>{
 assert.equal(cameraReadingCoverage([]).length,3);
 for(const row of cameraReadingCoverage([])){assert.equal(row.field,0);assert.equal(row.newest,null);}
});
