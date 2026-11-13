import {test,expect} from '@playwright/test';
import {mountFleet,fresh} from './fleet-dashboard-fixtures.mjs';
import {openFleetView} from './fleet-view-navigation-helper.mjs';
import {countUnits} from '../shared/starUnitStatus.ts';

const line=(unit,over={})=>({unit,placement:'FIELD',site:'Fixture customer - yard',siteNamePending:false,state:'GREEN',cameras:1,online:1,offline:0,unknown:0,down:[],onlineInShop:false,publicIp:null,observedAt:fresh,...over});
const units=[
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
 await expect(app.locator('.cos-camera-status-row')).toHaveCount(6);
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
