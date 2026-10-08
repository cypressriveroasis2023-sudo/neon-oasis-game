import {test,expect} from '@playwright/test';
import {port,snapshot,resource} from './fixtures/camera-evidence-fixtures.mjs';

// Synthetic resources, labels, coordinates and proof markers only. Every remote request is intercepted.
const now='2026-10-06T18:00:00Z',fresh='2026-10-06T17:55:00Z';
const uuid=n=>`90000000-0000-4000-8000-${String(n).padStart(12,'0')}`;
const ids={unlinked:uuid(1),owner:uuid(2),stand:uuid(3),native:uuid(4),recorder:uuid(5),service:uuid(6),unbound:uuid(7)};
const audit='99001';
const proof='a'.repeat(64);
const ownerKey='SOLARSPOTTER011';
const labels={unlinked:'Solar Spotter 011HDC4',owner:ownerKey,stand:'Solar Stand 72 044',native:'Solar Spotter 022HDC4',recorder:'Solar Spotter 044HDC1',service:'Synthetic service unit 55',unbound:'Synthetic service unit 56'};
const ownerIds=['91001','91002','91003','91004'];
function fixture({sourceCases=false}={}){
 const base={status:'installed',currentLocationType:'site',modelName:'Solar Spotter',address:'100 Fixture Road',site:'Synthetic identity test site',customer:'Synthetic customer',installedSiteId:uuid(90),latitude:29.76,longitude:-95.37,locationVerification:'owner_verified',gpsRecordedAt:fresh,locationVerifiedAt:fresh,coordinateSource:'site',hasUnitGps:true};
 const units=[{...base,id:ids.unlinked,unitNumber:labels.unlinked},{...base,id:ids.owner,unitNumber:labels.owner,modelName:'Camera unit',placementAuditId:audit,placementUnitKey:ownerKey,control_id:ids.owner},{...base,id:ids.stand,unitNumber:labels.stand,modelName:'SOLAR STANDS 72'}];
 const rows=ownerIds.map((id,index)=>resource(id,ownerKey,{name:`Synthetic Owner IPC ${index+1}`}));
 const identities=[{unitId:ids.owner,unitNumber:labels.owner,kind:'owner_placement',placementAuditId:audit,deviceIds:ownerIds,unitKeys:[ownerKey],proof}];
 if(sourceCases){
  for(const [i,key] of ['native','recorder','service','unbound'].entries())units.push({...base,id:ids[key],unitNumber:labels[key],latitude:29.86+i*.08,modelName:key==='service'||key==='unbound'?'Camera unit':'Solar Spotter',...(key==='service'?{placementAuditId:'99002',placementUnitKey:labels.service}:{})});
  rows.push(resource('92001','SOLARSPOTTER022',{name:'Synthetic native IPC'}),resource('93001','SOLARSPOTTER044',{name:'Synthetic native recorder',type:'NVR'}),resource('94001','Synthetic service source 55',{name:'Synthetic bound service',type:'unit_inventory',evidence:undefined,serviceEvidence:port()}),resource('95001','Synthetic service source 56',{name:'Synthetic unbound service',type:'unit_inventory',evidence:undefined,serviceEvidence:port()}));
  identities.push({unitId:ids.native,unitNumber:labels.native,kind:'native_provider',deviceIds:['92001'],unitKeys:['SOLARSPOTTER022'],proof},{unitId:ids.recorder,unitNumber:labels.recorder,kind:'native_provider',deviceIds:['93001'],unitKeys:['SOLARSPOTTER044'],proof},{unitId:ids.service,unitNumber:labels.service,kind:'owner_placement',placementAuditId:'99002',deviceIds:['94001'],unitKeys:['Synthetic service source 55'],proof});
 }
 return {units,rows,identities};
}
async function mount(page,{sourceCases=false,overview=false}={}){
 const data=fixture({sourceCases});
 const state={...data,warnings:[],writes:[],requests:[],blockedExternal:[],summaryError:0};
 state.health=()=>({...snapshot(state.rows),identityVersion:1,unitIdentities:state.identities,identityWarnings:state.warnings});
 await page.clock.install({time:new Date(now)});
 await page.route('**/*',async route=>{
  const request=route.request(),url=new URL(request.url());
  if(url.pathname==='/verified-health-identity-fixture')return route.fulfill({contentType:'text/html',body:`<meta name="viewport" content="width=device-width,initial-scale=1"><style>html,body{margin:0;height:100%}iframe{width:100%;height:100%;border:0}</style><iframe src="/#${overview?'camera-health':'field-map'}"></iframe><script>window.fixtureAuth=true;addEventListener('message',event=>{if(event.origin===location.origin&&event.data.type==='COS_OPERATIONS_TOKEN_REQUEST')event.source.postMessage({type:'COS_OPERATIONS_TOKEN_RESPONSE',requestId:event.data.requestId,role:window.fixtureAuth?'owner':'',accessToken:window.fixtureAuth?'synthetic-only':''},location.origin)})</script>`});
  if(url.protocol==='http:'&&url.hostname==='127.0.0.1')return route.continue();
  if(/^https:\/\/[abc]\.tile\.openstreetmap\.org\//.test(request.url()))return route.fulfill({contentType:'image/svg+xml',body:'<svg xmlns="http://www.w3.org/2000/svg" width="256" height="256"><rect width="256" height="256" fill="#e5eadd"/></svg>'});
  if(!url.pathname.endsWith('/functions/v1/cos-operations-pages')){state.blockedExternal.push(request.url());return route.abort('blockedbyclient');}
  const headers={'access-control-allow-origin':request.headers().origin||'*','access-control-allow-methods':'POST, OPTIONS','access-control-allow-headers':'authorization, content-type'};
  if(request.method()==='OPTIONS')return route.fulfill({status:204,headers});
  const body=request.postDataJSON();state.requests.push({...body,at:await page.evaluate(()=>Date.now())});
  if(body.method!=='GET'){state.writes.push(body);return route.fulfill({status:400,headers,body:JSON.stringify({error:'Synthetic test rejects writes'})});}
  if(body.path==='/api/camera-health/summary-v3'&&state.summaryError)return route.fulfill({status:state.summaryError,headers,contentType:'application/json',body:JSON.stringify({error:'Synthetic saved summary unavailable'})});
  const result=body.path==='/api/session'?{authorized:true,name:'Synthetic Owner',role:'Owner',features:{fieldLocationVerification:true,fleetAccess:true,fleetPlacementEdit:true,fleetConnectionEdit:true}}
   :body.path==='/api/field-map'?{items:state.units,summary:{fieldUnits:state.units.length,mappedUnits:state.units.length,unitGps:state.units.length,missingGps:0},generatedAt:now}
   :body.path==='/api/camera-health/summary-v3'?state.health()
   :body.path==='/api/routers'?{items:[],source:'camera_health',gpsAvailable:false,generatedAt:now}
   :body.path==='/api/equipment'?{items:state.units,models:[]}
   :body.path==='/api/owner/control-data'?{sites:[],truckChecks:[],itTechnicians:[],serviceTechnicians:[]}
   :{items:[]};
  return route.fulfill({headers,contentType:'application/json',body:JSON.stringify(result)});
 });
 await page.goto('/verified-health-identity-fixture');
 const frame=page.frameLocator('iframe');
 await expect(frame.locator(overview?'.camera-overview-card':'.field-map-list>button')).toHaveCount(overview?(sourceCases?5:1):state.units.length);
 await expect.poll(()=>state.requests.filter(r=>r.path==='/api/camera-health/summary-v3').length).toBeGreaterThan(0);
 return {frame,state};
}
const listUnit=(frame,label)=>frame.locator('.field-map-list>button').filter({has:frame.locator('strong').filter({hasText:new RegExp('^'+label+'$')})});
async function expand(frame){await frame.locator('.field-map-center').scrollIntoViewIfNeeded();await frame.locator('.cos-field-cluster-wrap').first().click();await frame.getByRole('button',{name:'Zoom into this group',exact:true}).click();await expect(frame.locator('.cos-field-pin')).toHaveCount(3);}
async function navigate(page,hash){await page.frames().find(frame=>frame.parentFrame()).evaluate(value=>{location.hash=value;},hash);}
async function noOverflow(frame){expect(await frame.locator('body').evaluate(el=>el.scrollWidth>innerWidth+1)).toBe(false);}
function noWrites(state){expect(state.writes).toEqual([]);expect(state.requests.every(request=>request.method==='GET')).toBe(true);expect(state.requests.some(request=>/probe|verify|diagnos|refresh-source/i.test(request.path))).toBe(false);}

test('Owner proof colors only its exact four IPCs; shared HDC label remains gray and stand blue',async({page},info)=>{
 const {frame,state}=await mount(page);
 await expect(frame.locator('.cos-field-cluster')).toHaveAttribute('data-health','mixed');
 await expect(frame.locator('.cos-cluster-caption')).toHaveText('MIX');
 await frame.locator('.field-map-center').scrollIntoViewIfNeeded();await frame.locator('.cos-field-cluster-wrap').click();
 await expect(frame.locator('.field-cluster-summary')).toContainText('1 online · 0 offline · 1 unknown · 1 support');
 await expect(frame.locator('.field-cluster-list button').filter({hasText:labels.owner})).toContainText('CAMERA RECORDS ONLINE');
 await frame.getByRole('button',{name:'Zoom into this group',exact:true}).click();
 await expect(frame.locator('.cos-field-pin')).toHaveCount(3);
 await expect(frame.locator('.cos-field-pin-wrap').filter({has:frame.locator('.cos-field-pin[data-health="online"]')})).toHaveAttribute('title',labels.owner+' · CAMERA RECORDS ONLINE');
 await expect(frame.locator('.cos-field-pin-wrap').filter({has:frame.locator('.cos-field-pin[data-health="unknown"]')})).toHaveAttribute('title',labels.unlinked+' · Camera status unverified');
 await expect(frame.locator('.cos-field-pin[data-health="online"] .cos-reticle-ring')).toHaveCSS('border-top-color','rgb(43, 255, 53)');
 await expect(frame.locator('.cos-field-pin-support .cos-reticle-ring')).toHaveCSS('border-top-color','rgb(21, 168, 255)');
 await frame.locator('.cos-field-pin-support').click();
 await expect(frame.getByRole('region',{name:'Selected unit camera health'})).toContainText('SUPPORT EQUIPMENT · 0 CAMERAS');
 await expect(frame.locator('.field-map-detail h2')).toHaveText(labels.stand);
 await frame.locator('.leaflet-popup-close-button').click();
 await noOverflow(frame);await frame.locator('.field-map-center').screenshot({path:info.outputPath('verified-owner-hdc-support.png')});
 await frame.locator('.cos-field-pin[data-health="online"]').click();
 await expect(frame.locator('.camera-unit-detail h3')).toHaveText(labels.owner);
 await expect(frame.locator('.camera-unit-state')).toHaveText('CAMERA RECORDS ONLINE');
 await expect(frame.locator('.camera-unit-detail')).toContainText('verified saved equipment-to-resource association');
 await expect(frame.locator('.camera-device-cards article')).toHaveCount(4);
 await expect(frame.locator('.camera-device-cards article strong')).toHaveText(ownerIds.map((_,index)=>`Synthetic Owner IPC ${index+1}`));
 await expect(frame.locator('.camera-device-cards .camera-resource-access')).toHaveCount(4);
 for(const [index,id] of ownerIds.entries())await expect(frame.locator('.camera-device-cards .camera-resource-access').nth(index)).toHaveAttribute('href','../../camera-detail.html?id='+id);
 await noOverflow(frame);
 await navigate(page,'camera-health');
 const owner=frame.locator('.camera-overview-card').filter({hasText:'Verified equipment: '+labels.owner});
 await expect(owner).toHaveCount(1);await expect(owner.locator('.camera-status-pill')).toHaveText('CAMERA RECORDS ONLINE');
 await expect(owner.getByRole('link',{name:'Field View',exact:true})).toHaveAttribute('href','../../?fieldUnit='+encodeURIComponent(labels.owner));
 await owner.locator('.camera-card-main').click();
 await expect(frame.getByRole('dialog',{name:'Camera Health unit details'})).toContainText('Field record: '+labels.owner);
 await expect(frame.getByRole('dialog',{name:'Camera Health unit details'}).locator('.camera-device-cards article')).toHaveCount(4);
 await noOverflow(frame);noWrites(state);
});

test('native HDC proof, recorder proof and bound service proof retain separate source labels and exact Field View',async({page},info)=>{
 const {frame,state}=await mount(page,{sourceCases:true,overview:true});
 const native=frame.locator('.camera-overview-card').filter({hasText:'Synthetic native IPC'});
 await expect(native.locator('.camera-status-pill')).toHaveText('CAMERA RECORDS ONLINE');
 await expect(native.getByRole('link',{name:'Field View',exact:true})).toHaveAttribute('href','../../?fieldUnit='+encodeURIComponent(labels.native));
 await native.locator('.camera-card-main').click();let detail=frame.getByRole('dialog',{name:'Camera Health unit details'});
 await expect(detail).toContainText('Field record: '+labels.native);await expect(detail.locator('.camera-device-cards article')).toHaveCount(1);
 await expect(detail.getByRole('link',{name:'Open saved IP / ports'})).toHaveAttribute('href','../../camera-detail.html?id=92001');
 await page.keyboard.press('Escape');await expect(native.locator('.camera-card-main')).toBeFocused();
 const recorder=frame.locator('.camera-overview-card').filter({hasText:'Synthetic native recorder'});
 await expect(recorder.locator('.camera-status-pill')).toHaveText('RECORDER ONLINE');await expect(recorder).toContainText('Camera channel status unavailable');
 await recorder.locator('.camera-card-main').click();await expect(detail).toContainText('Field record: '+labels.recorder);await expect(detail).toContainText('Camera channel status unavailable from this recorder observation.');await detail.getByRole('button',{name:'Back to units',exact:true}).click();
 const service=frame.locator('.camera-overview-card').filter({hasText:'Synthetic bound service'});
 await expect(service.locator('.camera-status-pill')).toHaveText('IP / PORT ONLINE');await expect(service).toContainText('Camera channel status unavailable');
 await noOverflow(frame);await page.screenshot({path:info.outputPath('source-separated-identity-overview.png'),fullPage:true});
 await navigate(page,'field-map');await expect(frame.locator('.field-map-list>button')).toHaveCount(7);
 await expect(listUnit(frame,labels.native)).toContainText('CAMERA RECORDS ONLINE');await expect(listUnit(frame,labels.recorder)).toContainText('RECORDER ONLINE');await expect(listUnit(frame,labels.service)).toContainText('IP / PORT ONLINE');
 await expect(listUnit(frame,labels.unbound)).not.toContainText('IP / PORT ONLINE');await expect(listUnit(frame,labels.unbound)).toContainText('unverified');
 await listUnit(frame,labels.recorder).click();await expect(frame.getByRole('region',{name:'Selected unit camera health'})).toContainText('RECORDER ONLINE');
 await navigate(page,'camera-health?unit='+ids.recorder);await expect(frame.locator('.camera-unit-state')).toHaveText('RECORDER ONLINE');await expect(frame.locator('.camera-unit-detail')).toContainText('Individual camera channels and video are not verified');await expect(frame.locator('.camera-device-cards article')).toHaveCount(1);
 noWrites(state);
});

test('saved-data reload repaints identity status without changing expanded map position or popup selection',async({page})=>{
 const {frame,state}=await mount(page);await expand(frame);
 const viewport=()=>frame.locator('body').evaluate(()=>history.state.cosFieldMapView);
 await frame.locator('.cos-field-pin-support').click();await expect(frame.locator('.field-map-detail h2')).toHaveText(labels.stand);await frame.locator('.leaflet-popup-close-button').click();
 const before=await viewport();
 state.rows=state.rows.map(row=>({...row,evidence:{...row.evidence,status:'offline'}}));
 await frame.getByRole('button',{name:'Refresh',exact:true}).click();
 await expect(frame.locator('.cos-field-pin[data-health="offline"]')).toHaveCount(1);await expect(frame.locator('.cos-field-pin[data-health="unknown"]')).toHaveCount(1);
 await expect(frame.locator('.field-map-detail h2')).toHaveText(labels.stand);
 await expect.poll(async()=>{const view=await viewport();return {center:view.center,zoom:view.zoom};}).toEqual({center:before.center,zoom:before.zoom});
 await frame.locator('.cos-field-cluster-wrap').click();await expect(frame.locator('.field-cluster-summary')).toContainText('0 online · 1 offline · 1 unknown · 1 support');
 await frame.locator('.leaflet-popup-close-button').click();await expect.poll(async()=>{const view=await viewport();return {center:view.center,zoom:view.zoom};}).toEqual({center:before.center,zoom:before.zoom});
 await frame.locator('.cos-field-cluster-wrap').click();
 await expect(frame.locator('.field-cluster-summary')).toBeVisible();
 await expect(frame.locator('.leaflet-pan-anim')).toHaveCount(0);
 const popupView=await viewport();
 state.rows=state.rows.map(row=>({...row,evidence:{...row.evidence,status:'online'}}));await frame.getByRole('button',{name:'Refresh',exact:true}).click();await expect(frame.locator('.cos-field-pin[data-health="online"]')).toHaveCount(1);
 await expect(frame.locator('.field-cluster-summary')).toContainText('1 online · 0 offline · 1 unknown · 1 support');
 await expect(frame.locator('.field-map-detail h2')).toHaveText(labels.stand);
 await expect.poll(async()=>{const view=await viewport();return {center:view.center,zoom:view.zoom};}).toEqual({center:popupView.center,zoom:popupView.zoom});
 await frame.locator('.leaflet-popup-close-button').click();
 await expect.poll(async()=>{const view=await viewport();return {center:view.center,zoom:view.zoom};}).toEqual({center:before.center,zoom:before.zoom});
 await noOverflow(frame);noWrites(state);
});

for(const mutation of ['partial resource set','extra resource in source group','changed Owner audit','changed Owner key','changed native label','explicit identity warning','duplicate resource ownership','duplicate equipment proof'])test(mutation+' never turns a mismatched unit green',async({page})=>{
 const {frame,state}=await mount(page);await expand(frame);
 if(mutation==='partial resource set')state.rows=state.rows.slice(0,3);
 if(mutation==='extra resource in source group')state.rows.push(resource('91005',ownerKey,{name:'Synthetic unexpected fifth IPC'}));
 if(mutation==='changed Owner audit')state.units[1].placementAuditId='99003';
 if(mutation==='changed Owner key')state.units[1].placementUnitKey='SOLARSPOTTER012';
 if(mutation==='changed native label')state.units[1].unitNumber='SOLARSPOTTER012';
 if(mutation==='explicit identity warning')state.warnings=[{unitId:ids.owner,reason:'Saved unit identity needs review.'}];
 if(mutation==='duplicate resource ownership')state.identities.push({...state.identities[0],unitId:ids.unlinked,unitNumber:labels.unlinked,kind:'native_provider'});
 if(mutation==='duplicate equipment proof')state.identities.push({...state.identities[0]});
 await frame.getByRole('button',{name:'Refresh',exact:true}).click();
 await expect(frame.locator('.cos-field-pin[data-health="online"]')).toHaveCount(0);await expect(frame.locator('.cos-field-pin[data-health="unknown"]')).toHaveCount(2);
 await expect(frame.locator('.cos-field-pin-support')).toHaveCount(1);
 await navigate(page,'camera-health?unit='+ids.owner);await expect(frame.locator('.camera-unit-state')).not.toContainText('ONLINE');await expect(frame.locator('.camera-device-cards article')).toHaveCount(0);
 if(mutation==='explicit identity warning')await expect(frame.locator('.camera-unit-detail')).toContainText('Saved unit identity needs review.');
 await noOverflow(frame);noWrites(state);
});

for(const failure of ['summary failure','expired authorization'])test(failure+' clears previously green identity evidence',async({page})=>{
 const {frame,state}=await mount(page);await expand(frame);await expect(frame.locator('.cos-field-pin[data-health="online"]')).toHaveCount(1);
 if(failure==='summary failure')state.summaryError=503;else await page.evaluate(()=>{window.fixtureAuth=false;});
 await frame.getByRole('button',{name:'Refresh',exact:true}).click();
 await expect(frame.getByRole('alert').filter({hasText:failure==='summary failure'?'Camera Health unavailable':'session is unavailable'}).first()).toBeVisible();
 await expect(frame.locator('.cos-field-pin[data-health="online"]')).toHaveCount(0);
 if(failure==='summary failure'){await expect(frame.locator('.cos-field-pin[data-health="unknown"]')).toHaveCount(2);await expect(frame.locator('.cos-field-pin-support')).toHaveCount(1);}
 noWrites(state);
});

test('15-minute saved-data polling stays unchanged and observations older than 20 minutes become gray',async({page})=>{
 const {frame,state}=await mount(page);await expand(frame);
 const summaryReads=()=>state.requests.filter(request=>request.path==='/api/camera-health/summary-v3').length;
 const baseline=summaryReads();await page.clock.fastForward(14*60*1000);expect(summaryReads()).toBe(baseline);await expect(frame.locator('.cos-field-pin[data-health="online"]')).toHaveCount(1);
 await page.clock.fastForward(60*1000);await expect.poll(summaryReads).toBe(baseline+1);
 await page.clock.fastForward(60*1000);await expect(frame.locator('.cos-field-pin[data-health="unknown"]')).toHaveCount(2);await expect(frame.locator('.cos-field-pin[data-health="online"]')).toHaveCount(0);
 await expect(frame.locator('.cos-field-pin-support .cos-reticle-ring')).toHaveCSS('border-top-color','rgb(21, 168, 255)');await expect(frame.locator('.field-map-display-bar')).toContainText('Saved status refreshes every 15 minutes');
 noWrites(state);
});

for(const conflict of ['scoped identity warning','duplicate resource ownership'])test(conflict+' removes overview unit proof without hiding independent source records',async({page})=>{
 const {frame,state}=await mount(page,{sourceCases:true,overview:true});
 const owner=frame.locator('.camera-overview-card').filter({has:frame.locator('.camera-card-main strong').filter({hasText:new RegExp('^'+ownerKey+'$')})});
 await expect(owner.locator('.camera-status-pill')).toHaveText('CAMERA RECORDS ONLINE');
 if(conflict==='scoped identity warning'){
  state.warnings=[{unitId:ids.owner,reason:'Saved unit identity needs review.',deviceIds:ownerIds,unitKeys:[ownerKey]}];
  state.identities=state.identities.filter(identity=>identity.unitId!==ids.owner);
 }else state.identities.push({...state.identities[0],unitId:ids.unlinked,unitNumber:labels.unlinked,kind:'native_provider'});
 await frame.getByRole('button',{name:'Reload saved results',exact:true}).click();
 await expect(owner.locator('.camera-status-pill')).toHaveText('EQUIPMENT LINK UNVERIFIED');
 await expect(owner.getByRole('link',{name:'Field View',exact:true})).toHaveCount(0);
 await expect(owner).toContainText('excluded from unit totals');
 const native=frame.locator('.camera-overview-card').filter({hasText:'Verified equipment: '+labels.native});
 await expect(native.locator('.camera-status-pill')).toHaveText('CAMERA RECORDS ONLINE');
 await expect(native.getByRole('link',{name:'Field View',exact:true})).toHaveAttribute('href','../../?fieldUnit='+encodeURIComponent(labels.native));
 await owner.locator('.camera-card-main').click();
 const detail=frame.getByRole('dialog',{name:'Camera Health unit details'});
 await expect(detail).toContainText('No unique current field record is linked');
 await expect(detail.getByRole('button',{name:'Create ticket',exact:true})).toHaveCount(0);
 await expect(detail.locator('.camera-device-cards article')).toHaveCount(4);
 await noOverflow(frame);noWrites(state);
});

test('one missing Owner IPC observation keeps the complete unit gray and out of provider-online totals',async({page})=>{
 const {frame,state}=await mount(page);await expand(frame);
 await expect(frame.locator('.cos-field-pin[data-health="online"]')).toHaveCount(1);
 state.rows=state.rows.map((row,index)=>index===3?{...row,evidence:undefined}:row);
 await frame.getByRole('button',{name:'Refresh',exact:true}).click();
 await expect(frame.locator('.cos-field-pin[data-health="online"]')).toHaveCount(0);
 await expect(frame.locator('.cos-field-pin[data-health="unknown"]')).toHaveCount(2);
 await expect(frame.locator('.cos-field-pin-support')).toHaveCount(1);
 await listUnit(frame,labels.owner).click();
 const selectedHealth=frame.getByRole('region',{name:'Selected unit camera health'});
 await expect(selectedHealth).toBeVisible();
 await expect(selectedHealth).toContainText('CAMERA RECORDS MIXED / PARTLY VERIFIED');
 await expect(selectedHealth).not.toContainText('SYSTEM ONLINE');
 await navigate(page,'camera-health');
 const owner=frame.locator('.camera-overview-card').filter({hasText:'Verified equipment: '+labels.owner});
 await expect(owner.locator('.camera-status-pill')).not.toContainText('ONLINE');
 await expect(owner).toContainText('3 camera/detector records online · 0 offline · 1 unverified');
 await expect(frame.locator('.camera-unit-kpi').filter({has:frame.locator('span').filter({hasText:/^Provider systems online$/})}).locator('b')).toHaveText('0');
 await expect(frame.locator('.camera-unit-kpi').filter({has:frame.locator('span').filter({hasText:/^Provider review$/})}).locator('b')).toHaveText('1');
 await owner.locator('.camera-card-main').click();
 const detail=frame.getByRole('dialog',{name:'Camera Health unit details'});
 await expect(detail.locator('.camera-device-cards article')).toHaveCount(4);
 await expect(detail.locator('.camera-device-cards article').nth(3)).toContainText('No verified provider camera/recorder observation.');
 await noOverflow(frame);noWrites(state);
});
