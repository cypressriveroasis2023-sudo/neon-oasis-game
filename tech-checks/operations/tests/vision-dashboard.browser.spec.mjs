import { test, expect } from '@playwright/test';
import { openWorkspace } from './navigation-helper.mjs';
import { auditDarkPresentation } from './dark-presentation-audit.mjs';
import {resource,snapshot,withStatus,now} from './fixtures/camera-evidence-fixtures.mjs';

const origin = 'http://127.0.0.1:4173';
const stamp = '2026-10-06T16:00:00Z';
const shop = { id:'11111111-1111-4111-8111-111111111111', unitNumber:'SHOP-FIX-001', modelName:'Fixture Spotter', status:'available', currentLocationType:'shop' };
const gps = { id:'22222222-2222-4222-8222-222222222222', unitNumber:'FIELD-FIX-001', status:'installed', currentLocationType:'site', site:'Fixture installed yard', address:'1 Fixture St, Houston, TX', latitude:29.7, longitude:-95.4, hasUnitGps:false, coordinateSource:'site',locationVerification:'owner_verified',gpsRecordedAt:stamp,locationVerifiedAt:stamp };
const address = { id:'33333333-3333-4333-8333-333333333333', unitNumber:'FIELD-FIX-002', status:'field', currentLocationType:'field', site:'Fixture address yard', address:'2 Fixture St, Houston, TX', latitude:null, longitude:null, hasUnitGps:false, readOnly:true, recordSource:'Fixture tracker', sourceVerifiedAt:stamp };
const unknown = { id:'44444444-4444-4444-8444-444444444444', unitNumber:'UNKNOWN-FIX-001', status:'available', currentLocationType:null };
async function mount(page) {
  const requests=[];
  await page.clock.setFixedTime(new Date(now));
  await page.route('**/*', async route => {
    const url=route.request().url();
    if(url===origin+'/vision-areas-fixture') return route.fulfill({contentType:'text/html',body:`<meta name="viewport" content="width=device-width,initial-scale=1"><style>body{margin:0}iframe{width:100%;height:100vh;border:0}</style><iframe src="/"></iframe><script>addEventListener('message',e=>{if(e.origin===location.origin&&e.data.type==='COS_OPERATIONS_TOKEN_REQUEST')e.source.postMessage({type:'COS_OPERATIONS_TOKEN_RESPONSE',requestId:e.data.requestId,role:'owner',accessToken:'synthetic-only'},location.origin)})</script>`});
    if(url.startsWith(origin+'/')) return route.continue();
    if(!url.endsWith('/functions/v1/cos-operations-pages')) return route.abort('blockedbyclient');
    const headers={'access-control-allow-origin':origin,'access-control-allow-methods':'POST, OPTIONS','access-control-allow-headers':'authorization, content-type'};
    if(route.request().method()==='OPTIONS') return route.fulfill({status:204,headers});
    const request=route.request().postDataJSON(); requests.push(request); expect(request.method).toBe('GET');
    const data=request.path==='/api/session'?{authorized:true,name:'Fixture owner',role:'Owner'}
      :request.path==='/api/equipment'?{items:[shop,gps,address,unknown],models:[]}
      :request.path==='/api/field-map'?{items:[gps,address],summary:{fieldUnits:2,mappedUnits:1,unitGps:0,missingGps:1},generatedAt:stamp}
      :request.path==='/api/routers'?{items:[],source:'camera_health',gpsAvailable:false,generatedAt:stamp}
      :request.path==='/api/camera-health/summary-v3'?snapshot([resource(1),withStatus(resource(2,'Helios 2'),'offline')])
      :request.path==='/api/daily-board'?{jobs:[],tasks:[],readiness:[],asOf:stamp}
      :{items:[]};
    return route.fulfill({headers,contentType:'application/json',body:JSON.stringify(data)});
  });
  await page.goto('/vision-areas-fixture');
  const frame=page.frameLocator('iframe');
  await expect(frame.getByRole('region',{name:'VISION dashboard'})).toBeVisible();
  return {frame,requests};
}
test('six dashboard areas use one menu and retain the approved theme', async ({page},testInfo) => {
  const {frame,requests}=await mount(page);
  const dashboard=frame.getByRole('region',{name:'VISION dashboard'});
  await expect(dashboard.locator('.vision-area-card')).toHaveCount(6);
  await expect(dashboard.getByRole('button',{name:/Camera Health/})).toContainText('2 active / unresolved units · Provider systems: 1 online · 1 offline · 0 review');
  await expect(dashboard).toContainText('1 confirmed on hand');
  await expect(dashboard).toContainText('1 placement not recorded');
  await dashboard.getByRole('button',{name:/Camera Health/}).click();
  await expect(frame.getByRole('region',{name:'Camera Health',exact:true})).toBeVisible();
  await openWorkspace(frame,'Units On Hand');
  const inventory=frame.getByRole('region',{name:'Units On Hand',exact:true});
  await expect(inventory).toContainText(shop.unitNumber);
  await expect(inventory).not.toContainText(gps.unitNumber);
  await expect(inventory).not.toContainText(unknown.unitNumber);
  await expect(inventory).toContainText('1 registry units have no recorded placement');
  await openWorkspace(frame,'Field Map');
  await frame.getByRole('button',{name:'Show all verified pins',exact:true}).click();
  await frame.getByRole('button',{name:/FIELD-FIX-002/}).click();
  await expect(frame.getByRole('link',{name:/Look up recorded installation address/})).toHaveAttribute('href','https://www.google.com/maps/search/?api=1&query=2%20Fixture%20St%2C%20Houston%2C%20TX');
  await expect(frame.getByText('Installed address available. A map pin needs verified coordinates.')).toBeVisible();
  await expect(frame.getByRole('button',{name:'Save verified location',exact:true})).toHaveCount(0);
  await expect(frame.getByRole('heading',{name:'Tracker location',exact:true})).toBeVisible();
  await openWorkspace(frame,'Today');
  const size=await frame.locator('body').evaluate(()=>({width:innerWidth,scroll:document.documentElement.scrollWidth}));
  expect(size.scroll).toBeLessThanOrEqual(size.width+1);
  expect((await auditDarkPresentation(frame.locator('body'))).failures).toEqual([]);
  expect(requests.every(request=>request.method==='GET')).toBe(true);
  await page.screenshot({path:testInfo.outputPath('vision-dashboard.png'),fullPage:true});
});
