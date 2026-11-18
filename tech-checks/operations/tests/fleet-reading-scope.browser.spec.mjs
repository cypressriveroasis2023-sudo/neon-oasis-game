import {test,expect} from '@playwright/test';
import {mountFleet,fresh} from './fleet-dashboard-fixtures.mjs';
import {openFleetView} from './fleet-view-navigation-helper.mjs';
import {countUnits} from '../shared/starUnitStatus.ts';
const unit=(name,source,observedAt,placement='FIELD')=>({unit:name,source,observedAt,placement,site:'Fixture site',siteNamePending:false,state:'UNKNOWN',cameras:1,online:0,offline:0,unknown:1,down:[],onlineInShop:false,publicIp:null});
const units=[unit('SPOTTER 101','star4live',fresh),unit('SNIPER 001','ip_check',null),unit('RII 001','reconeyez',fresh),unit('SNIPER 002','ip_check',fresh,'SHOP')];
const report={contract:'COS_STAR_UNIT_STATUS_V1',units,counts:countUnits(units),feed:{provider:'star4live',syncedAt:fresh,status:'ok',enabled:true,fresh:true,ageMs:1000},handEditsRead:true,otherSourcesRead:true,canEdit:false};
test('separate views explain populations and original observation times without operational writes',async({page},info)=>{
 const {app,state}=await mountFleet(page);
 const about=app.locator('.cos-phone-board-info > summary');
 if(await about.isVisible())await about.click();
 const fleet=app.getByRole('region',{name:'Fleet sources and scope'});
 await expect(fleet).toContainText('including camera units, stands and poles');
 await expect(fleet).toContainText('Saved board time:');
 await expect(fleet).toContainText('Do not add its totals');
 let fail=false;
 const cors={'access-control-allow-origin':'*','access-control-allow-headers':'*','access-control-allow-methods':'POST,OPTIONS'};
 await page.route('**/functions/v1/cos-unit-camera-status',route=>route.request().method()==='OPTIONS'?route.fulfill({status:204,headers:cors}):route.fulfill({status:fail?503:200,headers:cors,json:fail?{error:'Synthetic read failed'}:report}));
 await openFleetView(app,'Camera status');
 await app.locator('.cos-camera-about > summary').click();
 const scope=app.getByRole('region',{name:'Camera status sources and scope'});
 await expect(scope).toContainText('Separate provider readings');
 await expect(scope).toContainText('This sync time does not date the other sources');
 await scope.getByText('Sources, coverage and reading times',{exact:true}).click();
 const avigilon=scope.locator('dl > div').filter({hasText:'Avigilon unit connections'});
 await expect(avigilon).toContainText('1 Field units in this report');
 await expect(avigilon).toContainText('1 without a valid reading time');
 await expect(avigilon).toContainText('not individual camera or video verification');
 fail=true;await app.locator('.cos-camera-status-read button').click();
 await expect(scope).toContainText('Latest read failed');
 await expect(avigilon).toContainText('1 Field units in this report');
 expect(state.calls.filter(call=>call.method==='POST'&&!call.path.includes('refresh'))).toEqual([]);
 await page.screenshot({path:info.outputPath('reading-scope.png'),fullPage:true});
});

test('unavailable sources are unknown coverage, not zero healthy units',async({page})=>{
 const {app}=await mountFleet(page);
 const cors={'access-control-allow-origin':'*','access-control-allow-headers':'*','access-control-allow-methods':'POST,OPTIONS'};
 const partial={...report,units:[units[0]],counts:countUnits([units[0]]),otherSourcesRead:false,feed:{...report.feed,fresh:false}};
 await page.route('**/functions/v1/cos-unit-camera-status',route=>route.request().method()==='OPTIONS'?route.fulfill({status:204,headers:cors}):route.fulfill({status:200,headers:cors,json:partial}));
 await openFleetView(app,'Camera status');
 await app.locator('.cos-camera-about > summary').click();
 const scope=app.getByRole('region',{name:'Camera status sources and scope'});
 await expect(scope).toContainText('Not current');
 await scope.getByText('Sources, coverage and reading times',{exact:true}).click();
 await expect(scope.locator('dl > div').filter({hasText:'Avigilon unit connections'})).toContainText('Source unavailable; coverage unknown');
 await expect(scope.locator('dl > div').filter({hasText:'Reconeyez detectors'})).toContainText('Source unavailable; coverage unknown');
});

test('up evidence stays make-scoped and never labels a connection as verified video',async({page})=>{
 const {app,state}=await mountFleet(page);
 const upUnits=units.map(unit=>({...unit,state:'GREEN',online:1,unknown:0}));
 const cors={'access-control-allow-origin':'*','access-control-allow-headers':'*','access-control-allow-methods':'POST,OPTIONS'};
 await page.route('**/functions/v1/cos-unit-camera-status',route=>route.request().method()==='OPTIONS'?route.fulfill({status:204,headers:cors}):route.fulfill({status:200,headers:cors,json:{...report,units:upUnits,counts:countUnits(upUnits)}}));
 await openFleetView(app,'Camera status');
 await app.locator('.cos-camera-about > summary').click();
 const explanation=app.getByLabel('What the up count proves',{exact:true});
 await expect(explanation).toContainText('1 unit connections reachable · 1 camera groups reported up · 1 detector groups reported up');
 await expect(explanation).toContainText('These checks do not verify live video or recording');
 await app.getByRole('button',{name:/AVIGILON/}).click();
 await expect(explanation).toContainText('1 unit connections reachable · 0 camera groups reported up · 0 detector groups reported up');
 await expect(explanation).toContainText('Shop units excluded');
 await app.getByRole('button',{name:/ALL MAKES/}).click();
 await expect(explanation).toContainText('1 camera groups reported up · 1 detector groups reported up');
 expect(state.calls.filter(call=>call.method==='POST'&&!call.path.includes('refresh'))).toEqual([]);
});

test('stale offline history stays visible without claiming a current outage',async({page})=>{
 const {app}=await mountFleet(page);
 const oldCamera={name:'Historic detector',status:'unknown',lastReportedStatus:'offline',lastReportedAt:'2026-11-01T12:00:00Z'};
 const staleUnit={...units[2],down:[oldCamera],cameraList:[{...oldCamera,atSite:true}]};
 const cors={'access-control-allow-origin':'*','access-control-allow-headers':'*','access-control-allow-methods':'POST,OPTIONS'};
 await page.route('**/functions/v1/cos-unit-camera-status',route=>route.request().method()==='OPTIONS'?route.fulfill({status:204,headers:cors}):route.fulfill({status:200,headers:cors,json:{...report,units:[staleUnit],counts:countUnits([staleUnit])}}));
 await openFleetView(app,'Camera status');
 const row=app.locator('.cos-camera-status-row').filter({hasText:'Historic detector'});
 await expect(row).toContainText('Not verified: Historic detector (not verified; last reported offline');
 await expect(row).not.toContainText('Down: Historic detector');
 await expect(app.getByRole('group',{name:'Field cameras up, down and unknown'})).toContainText('Down 0');
});
