import {test,expect} from '@playwright/test';
import {snapshot as cameraSnapshot} from './fixtures/camera-evidence-fixtures.mjs';
import {sourceRecordedFixture,now,sha} from './fixtures/source-recorded-coordinates-fixture.mjs';
import {projectSourceRecordedCoordinates} from '../../supabase/functions/cos-operations-pages/sourceRecordedCoordinates.ts';
const origin=process.env.COS_MAP_TEST_ORIGIN||'http://127.0.0.1:4173';

test('distant tracker point yields approximate fallback and selected-only review details, with safe old DTO and refresh behavior',async({page},info)=>{
 const f=await sourceRecordedFixture({imported:true});
 f.row.locationImportedGeocode={jobKind:'native_import',binding:structuredClone(f.row.importedInstallation),status:'success',verified:false,liveGps:false,legacyGuardSha256:sha('legacy'),provider:'us_census_address_range',benchmark:'Public_AR_Current',latitude:31,longitude:-96,matchedAddress:'123 EXAMPLE RD, TEST CITY, TX, 77001',geocodedAt:'2026-10-08T19:00:00Z'};
 const projected=await projectSourceRecordedCoordinates(f.snapshot,[f.record],[],[],now),state={rows:projected.items,writes:[]};
 await page.clock.install({time:new Date(now)});
 await page.route('**/*',async route=>{
  const url=route.request().url();
  if(url===origin+'/source-conflict-fixture')return route.fulfill({contentType:'text/html',body:`<meta name="viewport" content="width=device-width,initial-scale=1"><style>html,body{margin:0;height:100%}iframe{width:100%;height:100%;border:0}</style><iframe src="/#field-map"></iframe><script>addEventListener('message',e=>{if(e.origin===location.origin&&e.data.type==='COS_OPERATIONS_TOKEN_REQUEST')e.source.postMessage({type:'COS_OPERATIONS_TOKEN_RESPONSE',requestId:e.data.requestId,role:'owner',accessToken:'synthetic-only'},location.origin)})</script>`});
  if(url.startsWith(origin+'/'))return route.continue();
  if(/^https:\/\/[abc]\.tile\.openstreetmap\.org\//.test(url))return route.fulfill({contentType:'image/svg+xml',body:'<svg xmlns="http://www.w3.org/2000/svg" width="256" height="256"><rect width="256" height="256" fill="#34495b"/></svg>'});
  if(!url.endsWith('/functions/v1/cos-operations-pages'))return route.abort('blockedbyclient');
  const headers={'access-control-allow-origin':origin,'access-control-allow-methods':'POST, OPTIONS','access-control-allow-headers':'authorization, content-type'};
  if(route.request().method()==='OPTIONS')return route.fulfill({status:204,headers});
  const request=route.request().postDataJSON();
  if(request.method!=='GET'){state.writes.push(request);return route.fulfill({status:400,headers,body:'{}'});}
  const data=request.path==='/api/session'?{authorized:true,name:'Synthetic Owner',role:'Owner',features:{fieldLocationVerification:true}}:request.path==='/api/field-map'?{...f.snapshot,items:state.rows,inventoryItems:state.rows,generatedAt:new Date(now).toISOString()}:request.path==='/api/camera-health/summary-v3'?cameraSnapshot([]):request.path==='/api/routers'?{items:[],source:'camera_health',gpsAvailable:false,generatedAt:new Date(now).toISOString()}:request.path==='/api/equipment'?{items:[],models:[],trackerUnits:state.rows}:request.path==='/api/daily-board'?{jobs:[],tasks:[],readiness:[],asOf:new Date(now).toISOString()}:{items:[]};
  return route.fulfill({headers,contentType:'application/json',body:JSON.stringify(data)});
 });
 await page.goto('/source-conflict-fixture');const frame=page.frameLocator('iframe');
 await expect(frame.locator('.cos-pin-location-tag')).toHaveText('EST');await expect(frame.locator('.cos-field-pin-recorded')).toHaveCount(0);
 await expect(frame.getByRole('region',{name:'Tracker point conflict'})).toHaveCount(0);
 await frame.locator('.field-map-list>button').click();
 const detail=frame.getByRole('complementary',{name:'Selected unit details'}),conflict=frame.getByRole('region',{name:'Tracker point conflict'});
 await expect(conflict).toContainText('current address estimate');await expect(conflict).toContainText('30, -95');
 await expect(conflict).toContainText('still approximate');await expect(frame.getByRole('region',{name:'Address estimate'})).toContainText('31, -96');
 await expect(detail).toContainText('Last unit GPSNot recorded');await expect(frame.getByLabel('Nearby unit center').locator('option[value="'+f.row.id+'"]')).toHaveCount(0);
 await expect(frame.getByRole('button',{name:'Save verified location',exact:true})).toHaveCount(0);
 await detail.scrollIntoViewIfNeeded();await detail.screenshot({path:info.outputPath('source-conflict-selected-details.png')});
 await conflict.scrollIntoViewIfNeeded();await conflict.screenshot({path:info.outputPath('source-conflict-review-explanation.png')});
 await frame.getByRole('region',{name:'Address estimate'}).screenshot({path:info.outputPath('source-conflict-fallback-provenance.png')});
 await frame.getByRole('button',{name:'Close unit details',exact:true}).click();await expect(detail).toBeHidden();
 await frame.locator('.field-map-center').scrollIntoViewIfNeeded();await frame.locator('.field-map-center').screenshot({path:info.outputPath('source-conflict-approximate-map.png')});
 await frame.locator('.field-map-list>button').click();await expect(conflict).toBeVisible();
 // An older backend can still return SRC; the shared client validator rejects it.
 state.rows=[f.row];await frame.getByRole('button',{name:'Refresh',exact:true}).click();
 await expect(frame.locator('.cos-pin-location-tag')).toHaveText('EST');await expect(frame.locator('.cos-field-pin-recorded')).toHaveCount(0);await expect(conflict).toHaveCount(0);
 // A fresh nearby lookup restores eligible SRC and removes stale conflict details.
 f.row.locationImportedGeocode={...f.row.locationImportedGeocode,latitude:30.01,longitude:-95};
 state.rows=(await projectSourceRecordedCoordinates(f.snapshot,[f.record],[],[],now)).items;
 await frame.getByRole('button',{name:'Refresh',exact:true}).click();await expect(frame.locator('.cos-pin-location-tag')).toHaveText('SRC');await expect(conflict).toHaveCount(0);
 await expect(frame.getByRole('region',{name:'Tracker-recorded coordinates'})).toContainText('measurement time is unknown');
 await page.reload();await expect(frame.locator('.cos-pin-location-tag')).toHaveText('SRC');expect(state.writes).toHaveLength(0);
});
