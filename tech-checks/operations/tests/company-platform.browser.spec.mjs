import { test, expect } from '@playwright/test';
import { workspaces, workspaceLabel } from '../src/workspaceNavigation.ts';

const origin = 'http://127.0.0.1:4173';
const edge = 'https://tughscoxralhofrckvxy.supabase.co/functions/v1/cos-operations-pages';
const external = ['Work Requests','CRM','Accounting','Collections','Payments','Needs Attention','History','Reports','Activity'];
// This complete navigation sweep uses synthetic empty source snapshots only.
// Every non-local transport is intercepted; operational writes fail the test.
async function mount(page, denied = false) {
  const requests = [];
  await page.route('**/*', async route => {
    const url = route.request().url();
    if (url === origin + '/company-platform-fixture') return route.fulfill({ contentType:'text/html', body:`<meta name="viewport" content="width=device-width,initial-scale=1"><style>body{margin:0}iframe{width:100%;height:100vh;border:0}</style><iframe title="COS fixture" src="/"></iframe><script>addEventListener('message',event=>{if(event.origin===location.origin&&event.data.type==='COS_OPERATIONS_TOKEN_REQUEST')event.source.postMessage({type:'COS_OPERATIONS_TOKEN_RESPONSE',requestId:event.data.requestId,role:'owner',accessToken:'synthetic-only'},location.origin)})</script>` });
    if (url.startsWith(origin + '/')) return route.continue();
    if (url !== edge) return route.abort('blockedbyclient');
    const headers = { 'access-control-allow-origin':origin,'access-control-allow-methods':'POST, OPTIONS','access-control-allow-headers':'authorization, content-type' };
    if (route.request().method() === 'OPTIONS') return route.fulfill({ status:204, headers });
    const request = route.request().postDataJSON();
    requests.push(request);
    expect(request.method).toBe('GET');
    const stamp = new Date().toISOString();
    const data = request.path === '/api/session' ? { authorized:!denied, role:'Owner', name:'Fixture owner', reason:denied?'Fixture access denied':'' }
      : request.path === '/api/routers' ? { items:[], source:'camera_health', gpsAvailable:false, generatedAt:stamp }
      : request.path === '/api/camera-health/summary' ? { totalDevices:0, online:0, offline:0, review:0, shopRoot:0, healthRows:0, fieldDevices:0, refreshedAt:stamp, rows:[] }
      : request.path === '/api/daily-board' ? { jobs:[], tasks:[], readiness:[], asOf:stamp }
      : request.path === '/api/field-map' ? { items:[], summary:{fieldUnits:0,mappedUnits:0,unitGps:0,missingGps:0}, generatedAt:stamp }
      : request.path === '/api/owner/control-data' ? { sites:[], truckChecks:[], serviceTechnicians:[], itTechnicians:[] }
      : { items:[] };
    return route.fulfill({ headers, contentType:'application/json', body:JSON.stringify(data) });
  });
  await page.goto('/company-platform-fixture');
  const frame = page.frameLocator('iframe');
  await expect(frame.getByText(denied?'ACCESS UNAVAILABLE':'OPERATIONS CONNECTED',{exact:true})).toBeVisible();
  return { frame, requests };
}

test('every company destination remains reachable with a light responsive boundary', async ({page}, testInfo) => {
  test.setTimeout(120000);
  const {frame, requests} = await mount(page);
  for (const workspace of workspaces.filter(name => !['Vision','Invoices'].includes(name))) {
    await frame.getByRole('button',{name:'More',exact:true}).click();
    const menu = frame.getByRole('dialog',{name:'Operations navigation'});
    await menu.getByRole('navigation',{name:'COS Operations',exact:true}).getByRole('button',{name:workspaceLabel(workspace),exact:true}).click();
    await expect(menu).toHaveCount(0);
    await expect.poll(() => frame.locator('body').evaluate(()=>location.hash)).toBe('#' + workspace.toLowerCase().replaceAll(' ','-'));
    await expect(frame.locator('.owner-it-main')).toBeVisible();
    if (external.includes(workspace)) {
      const boundary = frame.getByRole('region',{name:workspace+' workspace'});
      await expect(boundary).toContainText('AppDeploy');
      await expect(boundary.getByRole('link')).toHaveAttribute('href','https://cos-operations-platform-preview-wpbf1y.v2.appdeploy.ai/');
      await expect(boundary.getByRole('link')).toHaveAttribute('rel','noopener noreferrer');
    }
    const measurements = await frame.locator('body').evaluate(()=>({width:innerWidth,scroll:document.documentElement.scrollWidth,background:getComputedStyle(document.body).backgroundColor,text:getComputedStyle(document.body).color}));
    expect(measurements.scroll, workspace+' must fit').toBeLessThanOrEqual(measurements.width+1);
    expect(measurements.background, workspace+' must use light presentation').not.toMatch(/rgb\((?:5|8|13|17),/);
    await expect(frame.locator('.operations-shell')).not.toBeEmpty();
  }
  expect(requests.every(request=>request.method==='GET')).toBe(true);
  await page.screenshot({path:testInfo.outputPath('company-route-sweep.png'),fullPage:true});
});

test('denied company access retains readable legacy exits without loading company records', async ({page}) => {
  const {frame,requests}=await mount(page,true);
  await expect(frame.getByRole('heading',{name:'Operations access needs attention'})).toBeVisible();
  await expect(frame.getByRole('region',{name:'Tech Check workspaces'}).getByRole('button',{name:/IT Tech Check/})).toBeVisible();
  expect(requests.map(request=>request.path)).toEqual(['/api/session']);
  const size=await frame.locator('body').evaluate(()=>({width:innerWidth,scroll:document.documentElement.scrollWidth}));
  expect(size.scroll).toBeLessThanOrEqual(size.width+1);
});
