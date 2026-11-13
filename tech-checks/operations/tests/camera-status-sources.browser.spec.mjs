import {test,expect} from '@playwright/test';
import {mountFleet,fresh} from './fleet-dashboard-fixtures.mjs';
import {openFleetView} from './fleet-view-navigation-helper.mjs';
import {countUnits} from '../shared/starUnitStatus.ts';

const line=(unit,over={})=>({unit,placement:'FIELD',site:'Fixture customer - yard',siteNamePending:false,state:'GREEN',cameras:1,online:1,offline:0,unknown:0,down:[],onlineInShop:false,publicIp:null,observedAt:fresh,...over});
const units=[
 // Three units at one address and two at another: Vision's case.
 line('SPOTTER 101',{address:'1 Shared Yard Rd',location:{latitude:29.8646,longitude:-95.2614,matchedAddress:null,source:'hand'}}),
 line('SPOTTER 102',{state:'RED',online:0,offline:2,cameras:2,down:[{name:'CAM 1',status:'offline'},{name:'CAM 2',status:'offline'}],address:'1 Shared Yard Rd',location:{latitude:29.8646,longitude:-95.2614,matchedAddress:null,source:'hand'}}),
 line('SPOTTER 103',{address:'1 Shared Yard Rd',location:{latitude:29.8646,longitude:-95.2614,matchedAddress:null,source:'hand'}}),
 line('CAMV 002',{source:'ip_check',site:null,publicIp:'203.0.113.2'}),
 line('HELIOS 001',{source:'star4live',cameras:4,online:4}),
 line('RII010 - Arcosa',{source:'reconeyez',site:null,cameras:3,online:2,unknown:1,state:'YELLOW',down:[{name:'CAM 3',status:'unknown'}]}),
 line('SNIPER 004',{source:'ip_check',site:null,state:'RED',online:0,offline:1,publicIp:'203.0.113.4',down:[{name:'Avigilon check',status:'offline'}]}),
 line('SNIPER 007',{source:'ip_check',site:null,state:'UNKNOWN',online:0,unknown:1,publicIp:'203.0.113.7',down:[{name:'Avigilon check',status:'unknown'}]}),
 line('SPOTTER 306',{cameras:2,online:2}),
];
const report={contract:'COS_STAR_UNIT_STATUS_V1',units,counts:countUnits(units),feed:{provider:'star4live',syncedAt:fresh,status:'ok',enabled:true,fresh:true,ageMs:1000},handEditsRead:true,otherSourcesRead:true,canEdit:true,refreshedAt:fresh,source:'Star4Live'};
const row=(app,name)=>app.locator('.cos-camera-status-row').filter({has:app.getByText(name,{exact:true})});

test('Camera status lists Avigilon, Reconeyez and Star4Live units with their source, and Victron on a Helios',async({page},info)=>{
 const {app}=await mountFleet(page);
 // The Camera status tab reads from its own function; answer it with the synthetic report.
 const cors={'access-control-allow-origin':'*','access-control-allow-headers':'*','access-control-allow-methods':'POST,OPTIONS'};
 await page.route('**/functions/v1/cos-unit-camera-status',route=>route.request().method()==='OPTIONS'?route.fulfill({status:204,headers:cors}):route.fulfill({status:200,headers:cors,json:report}));
 await openFleetView(app,'Camera status');
 await expect(app.locator('.cos-camera-status-row')).toHaveCount(9);
 await expect(row(app,'SNIPER 004').locator('.cos-camera-status-detail')).toContainText('AvigilonDown');
 await expect(row(app,'SNIPER 004')).toContainText('The unit did not answer.');
 await expect(row(app,'SNIPER 007').locator('.cos-camera-status-detail')).toContainText('AvigilonNot verified');
 await expect(row(app,'CAMV 002')).toContainText('The unit answers. Each camera is not checked.');
 await expect(row(app,'RII010 - Arcosa').locator('.cos-camera-status-detail')).toContainText('ReconeyezSome cameras down · 2 of 3 up');
 await expect(row(app,'SPOTTER 306').locator('.cos-camera-status-detail')).toContainText('Star4LiveAll cameras up · 2 of 2 up');
 await expect(row(app,'HELIOS 001').locator('.cos-camera-status-victron')).toContainText('Victron · Charge 80 %');
 // The Fleet map's saved addresses place the same units here, marked unconfirmed.
 await expect(app.locator('.cos-camera-status-map-key small')).toContainText('field units on the map');
 await expect(row(app,'SPOTTER 306').locator('.cos-camera-status-victron')).toHaveCount(0);
 await row(app,'SNIPER 004').getByRole('button',{name:'Edit by hand'}).click();
 await expect(app.getByLabel('Public IP')).toHaveCount(0);
 await expect(row(app,'SNIPER 004').getByRole('button',{name:'In the shop',exact:true})).toBeVisible();
 await page.screenshot({path:info.outputPath('camera-status-sources.png'),fullPage:true});
});

test('units at one address do not hide each other: they group, and the group opens its member list',async({page},info)=>{
 const {app}=await mountFleet(page);
 const cors={'access-control-allow-origin':'*','access-control-allow-headers':'*','access-control-allow-methods':'POST,OPTIONS'};
 await page.route('**/functions/v1/cos-unit-camera-status',route=>route.request().method()==='OPTIONS'?route.fulfill({status:204,headers:cors}):route.fulfill({status:200,headers:cors,json:report}));
 await openFleetView(app,'Camera status');
 const canvas=app.locator('.cos-camera-status-map-canvas');
 await expect(canvas).toBeVisible();
 // Every pinned unit is reachable: either its own pin or a group that names it.
 const markers=app.locator('.cos-camera-status-map .leaflet-marker-icon');
 await expect(markers).not.toHaveCount(0);
 const reachable=await markers.evaluateAll(nodes=>nodes.flatMap(node=>{
  const ids=node.getAttribute('data-group-member-ids');
  return ids?JSON.parse(ids):[node.getAttribute('data-unit-id')].filter(Boolean);
 }));
 for(const unit of ['SPOTTER 101','SPOTTER 102','SPOTTER 103'])expect(reachable).toContain(unit);
 const group=app.locator('[data-group-count]').first();
 if(await group.count()){
  await group.click();
  await expect(app.locator('.cos-compact-group-popup')).toBeVisible();
 }else{
  // Below the grouping threshold each pin is moved aside instead of stacked.
  const places=await markers.evaluateAll(nodes=>nodes.map(n=>n.style.transform));
  expect(new Set(places).size).toBe(places.length);
 }
 await page.screenshot({path:info.outputPath('camera-status-groups.png'),fullPage:true});
});

test('past the grouping threshold a crowd of units becomes one badge that lists them',async({page},info)=>{
 const {app}=await mountFleet(page);
 // Twenty-two units at one yard: one badge, not twenty-two pins on one spot.
 const crowd=Array.from({length:22},(_,i)=>line('SPOTTER '+(200+i),{state:i===3?'RED':i===4?'YELLOW':'GREEN',
  online:i===3?0:1,offline:i===3?1:0,address:'1 Shared Yard Rd',
  location:{latitude:29.8646,longitude:-95.2614,matchedAddress:null,source:'hand'}}));
 const crowded={...report,units:crowd,counts:countUnits(crowd)};
 const cors={'access-control-allow-origin':'*','access-control-allow-headers':'*','access-control-allow-methods':'POST,OPTIONS'};
 await page.route('**/functions/v1/cos-unit-camera-status',route=>route.request().method()==='OPTIONS'?route.fulfill({status:204,headers:cors}):route.fulfill({status:200,headers:cors,json:crowded}));
 await openFleetView(app,'Camera status');
 const group=app.locator('.cos-camera-status-map [data-group-count]');
 await expect(group).toHaveCount(1);
 await expect(group).toHaveAttribute('data-group-count','22');
 await expect(group).toHaveAttribute('aria-label',/22 units here/);
 await group.click();
 const popup=app.locator('.cos-compact-group-popup');
 await expect(popup).toBeVisible();
 await expect(popup).toContainText('SPOTTER 203');
 await expect(popup).toContainText('SPOTTER 204');
 await page.screenshot({path:info.outputPath('camera-status-group-badge.png')});
});
