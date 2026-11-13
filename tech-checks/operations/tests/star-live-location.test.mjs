// Star4Live live location: Field/Shop and site follow the provider's current
// organization for each camera, not the name COS imported once in September.
import test from 'node:test';
import assert from 'node:assert/strict';
import {readFileSync} from 'node:fs';
import {starKnownSiteNames,starLiveOrganization,starPendingSiteName,STAR_ROOT_ORGANIZATION_ID as ROOT} from '../../supabase/functions/camera-provider-reconcile/star-live-location.js';

const res=(serial,organizationId,extra={})=>({deviceSerial:serial,deviceName:serial,organizationId,...extra});
const local=(serial,organization,oid)=>[serial.toLowerCase(),{device_serial:serial,organization,source_metadata:{organizationId:oid}}];
const run=(resources,locals)=>{const known=starKnownSiteNames(resources,new Map(locals));return Object.fromEntries(resources.map(r=>[r.deviceSerial,starLiveOrganization(r,known)]));};

test('a camera in the account root is Shop, whatever customer name COS still holds for it',()=>{
 const out=run([res('A1',ROOT)],[local('A1','Harvey Cleary - SEC Energy Building 12',ROOT)]);
 assert.equal(out.A1,'root');
});
test('a camera at a site keeps the site name its organization already has in COS',()=>{
 const out=run([res('B1','500'),res('B2','500'),res('B3','500')],[local('B1','Hyperion - Enchanted Rock','500'),local('B2','Hyperion - Enchanted Rock','500'),local('B3','Hyperion - Enchanted Rock','500')]);
 assert.deepEqual(out,{B1:'Hyperion - Enchanted Rock',B2:'Hyperion - Enchanted Rock',B3:'Hyperion - Enchanted Rock'});
});
test('a camera moved out of the shop takes the name of the site it joined, not "root"',()=>{
 const out=run([res('C1','500'),res('C2','500'),res('C3','500')],[local('C1','Site A','500'),local('C2','Site A','500'),local('C3','root','500')]);
 assert.equal(out.C3,'Site A');
});
test('a camera that arrived from another site does not rename the site it joined',()=>{
 // Its stored organization id is still the old site's, so its old name is not a vote for the new site.
 const out=run([res('D1','500'),res('D2','500'),res('D3','500')],[local('D1','Site A','500'),local('D2','Site A','500'),local('D3','Old Site','400')]);
 assert.deepEqual(out,{D1:'Site A',D2:'Site A',D3:'Site A'});
});
test('a camera that moved alone to a new site does not carry its old site name there',()=>{
 // After one sync COS's stored organization id is already the new one, so only the name gives it away.
 const out=run([res('J1','400'),res('J2','400'),res('J3','450')],[local('J1','Site A','400'),local('J2','Site A','400'),local('J3','Site A','450')]);
 assert.deepEqual(out,{J1:'Site A',J2:'Site A',J3:starPendingSiteName('450')});
 // Two single-camera organizations claiming one name: neither is guessed.
 const tie=run([res('K1','460'),res('K2','470')],[local('K1','Site Z','460'),local('K2','Site Z','470')]);
 assert.deepEqual(tie,{K1:starPendingSiteName('460'),K2:starPendingSiteName('470')});
});
test('a site COS has never seen is shown honestly as pending, and still counts as a site',()=>{
 const out=run([res('E1','777')],[local('E1','root',ROOT)]);
 assert.equal(out.E1,starPendingSiteName('777'));assert.match(out.E1,/^Star4Live site #777 \(name pending\)$/);assert.notEqual(out.E1.toLowerCase(),'root');
 // A pending label is never treated as a real name on the next sync.
 const again=run([res('E1','777'),res('E2','777')],[local('E1',starPendingSiteName('777'),'777'),local('E2',starPendingSiteName('777'),'777')]);
 assert.equal(again.E2,starPendingSiteName('777'));
});
test('when the cameras of one site disagree with no clear majority, no name is guessed',()=>{
 const out=run([res('F1','600'),res('F2','600')],[local('F1','Name One','600'),local('F2','Name Two','600')]);
 assert.equal(out.F1,starPendingSiteName('600'));assert.equal(out.F2,starPendingSiteName('600'));
 // A single stray name among several cameras is not enough either.
 const lone=run([res('G1','610'),res('G2','610'),res('G3','610')],[local('G1','Only One','610'),local('G2','root','610'),local('G3','root','610')]);
 assert.equal(lone.G1,starPendingSiteName('610'));
});
test('a name the provider itself supplies always wins, and missing organization data changes nothing',()=>{
 const out=run([res('H1','900',{organizationName:'Evergen Equity - Chair King'}),res('H2','900')],[local('H1','root',ROOT),local('H2','Something Old','900')]);
 assert.deepEqual(out,{H1:'Evergen Equity - Chair King',H2:'Evergen Equity - Chair King'});
 assert.equal(starLiveOrganization({deviceSerial:'I1'},new Map()),undefined);
 assert.equal(starLiveOrganization({deviceSerial:'I2',organizationId:''},new Map()),undefined);
 assert.equal(starLiveOrganization({deviceSerial:'I3',orgId:Number(ROOT)},new Map()),'root');
});
test('the sync writes the live organization for matched cameras and changes nothing in Star4Live',()=>{
 const src=readFileSync(new URL('../../supabase/functions/camera-provider-reconcile/index.ts',import.meta.url),'utf8');
 assert.match(src,/import \{starKnownSiteNames,starLiveOrganization\} from "\.\/star-live-location\.js"/);
 assert.match(src,/from\("star4live_site_names"\)\.select\("organization_id,name"\)/);
 assert.match(src,/\.\.\.\(liveOrganization===undefined\?\{\}:\{organization:liveOrganization\}\)/);
 // Still the same three read calls and nothing else to the provider.
 assert.deepEqual([...new Set(src.match(/openapi\/[A-Za-z0-9/_-]+/g))].sort(),['openapi/user/account/server/getbyloginname','openapi/user/account/token/get','openapi/user/organization/sub/resource/list']);
});

test('a name a person verified for a site number wins, and exposes the same name carried elsewhere as stale',()=>{
 // SS263's site (#1512402) was verified as "Division 1 New Caney"; SS039 (#1826680) still carries that name from September.
 const resources=[res('L1','1512402'),res('L2','1512402'),res('L3','1512402'),res('M1','1826680'),res('M2','1826680'),res('M3','1826680'),res('M4','1826680')];
 const locals=[local('L1',starPendingSiteName('1512402'),'1512402'),local('L2',starPendingSiteName('1512402'),'1512402'),local('L3',starPendingSiteName('1512402'),'1512402'),
  local('M1','Division 1 New Caney','1826680'),local('M2','Division 1 New Caney','1826680'),local('M3','Division 1 New Caney','1826680'),local('M4','Division 1 New Caney','1826680')];
 const known=starKnownSiteNames(resources,new Map(locals),undefined,[{organization_id:'1512402',name:'Division 1 New Caney'}]);
 assert.equal(starLiveOrganization(resources[0],known),'Division 1 New Caney');
 assert.equal(starLiveOrganization(resources[3],known),starPendingSiteName('1826680'),'the larger group no longer keeps a name verified for another site');
 // Without the verified entry the old majority rule would have named the wrong site.
 assert.equal(starLiveOrganization(resources[3],starKnownSiteNames(resources,new Map(locals))),'Division 1 New Caney');
 // Verified names ignore root, blanks and pending labels, and never rename root.
 const odd=starKnownSiteNames([res('N1',ROOT),res('N2','900')],new Map([local('N1','root',ROOT),local('N2','Old','900')]),undefined,[{organization_id:ROOT,name:'Not Root'},{organization_id:'900',name:' '},{organization_id:'901',name:'root'},null]);
 assert.equal(starLiveOrganization(res('N1',ROOT),odd),'root');assert.equal(starLiveOrganization(res('N2','900'),odd),'Old');
});
