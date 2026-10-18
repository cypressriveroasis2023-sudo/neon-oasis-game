import { test, expect } from '@playwright/test';
import { openWorkspace } from './navigation-helper.mjs';
import { auditDarkPresentation } from './dark-presentation-audit.mjs';
import {resource,snapshot,withStatus,now} from './fixtures/camera-evidence-fixtures.mjs';
const origin = 'http://127.0.0.1:4173';
const stamp = '2026-10-06T13:00:00.000Z';
const jobs = [
  { id: '11111111-1111-4111-8111-111111111111', jobNumber: 'FIX-101', jobType: 'Delivery', customer: 'Fixture customer', site: 'Fixture site', status: 'Unscheduled', stage: 'IT Prep' },
  { id: '22222222-2222-4222-8222-222222222222', jobNumber: 'FIX-102', jobType: 'Delivery', customer: 'Fixture customer', site: 'Fixture site', status: 'Scheduled', stage: 'IT Prep' },
  { id: '33333333-3333-4333-8333-333333333333', jobNumber: 'FIX-103', jobType: 'Delivery', customer: 'Fixture customer', site: 'Fixture site', status: 'In Progress', stage: 'Service Delivery' },
  { id: '44444444-4444-4444-8444-444444444444', jobNumber: 'FIX-104', jobType: 'Delivery', customer: 'Fixture customer', site: 'Fixture site', status: 'Owner Review', stage: 'Owner Review' },
  { id: '55555555-5555-4555-8555-555555555555', jobNumber: 'FIX-105', jobType: 'Delivery', customer: 'Fixture customer', site: 'Fixture site', status: 'Billing Ready', stage: 'Billing' },
];
const camera = snapshot([resource(1),withStatus(resource(2,'Helios 2'),'offline'),withStatus(resource(3,'Helios 3'),'unknown')]);
const router = { id: 'r1', unitKey: 'Fixture Unit', name: 'Fixture router', model: 'Fixture', publicIp: null, unitIp: null, port: null, protocol: null, probeStatus: 'unknown', checkedAt: null, lastRecoveredAt: null, reportedStatus: 'Unknown', reportedAt: null, reportedSource: 'Fixture', savedLatencyMs: null, match: 'unmatched', candidateUnit: null, gps: null };
async function mount(page,{cameraData=camera}={}) {
  const state = { failures: new Set(), requests: [],camera:cameraData };
  await page.clock.setFixedTime(new Date(now));
  await page.route('**/*', async route => {
    const url = route.request().url();
    if (url === origin + '/company-overview-test') return route.fulfill({ contentType: 'text/html', body: `<html><head><meta name="viewport" content="width=device-width,initial-scale=1"><style>body{margin:0}iframe{border:0;width:100%;height:100vh}</style></head><body><iframe title="Company overview test" src="/#today"></iframe><script>addEventListener('message',e=>{if(e.origin===location.origin&&e.data.type==='COS_OPERATIONS_TOKEN_REQUEST')e.source.postMessage({type:'COS_OPERATIONS_TOKEN_RESPONSE',requestId:e.data.requestId,accessToken:'synthetic-only',role:'owner'},location.origin)});</script></body></html>` });
    if (url.startsWith(origin + '/')) return route.continue();
    if (!url.endsWith('/functions/v1/cos-operations-pages')) return route.abort('blockedbyclient');
    const headers = { 'access-control-allow-origin': origin, 'access-control-allow-methods': 'POST, OPTIONS', 'access-control-allow-headers': 'authorization, content-type' };
    if (route.request().method() === 'OPTIONS') return route.fulfill({ status: 204, headers });
    const request = route.request().postDataJSON();
    state.requests.push(request);
    if (request.method !== 'GET') throw new Error('Overview made an unexpected write');
    if (state.failures.has(request.path)) return route.fulfill({ status: 503, headers, contentType: 'application/json', body: JSON.stringify({ error: 'Fixture unavailable' }) });
    const fieldUnits=[1,2,3].map(n=>({id:'80000000-0000-4000-8000-'+String(n).padStart(12,'0'),unitNumber:'Helios '+n,modelName:'Helios',status:'field',currentLocationType:'field',address:'Synthetic '+n+' Main St'}));
    const data = request.path === '/api/field-map'?{items:fieldUnits,inventoryItems:fieldUnits,summary:{fieldUnits:3,mappedUnits:0,unitGps:0,missingGps:3},generatedAt:stamp}:request.path === '/api/session' ? { authorized: true, name: 'Fixture Owner', role: 'Owner' }
      : request.path === '/api/jobs' ? { items: jobs }
      : request.path === '/api/camera-health/summary-v3' ? state.camera
      : request.path === '/api/routers' ? { items: [router], generatedAt: stamp, source: 'camera_health', gpsAvailable: false }
      : request.path === '/api/quotes' ? { items: [{ id: 'q1', quoteNumber: 'FIX-Q1', status: 'Draft' }, { id: 'q2', quoteNumber: 'FIX-Q2', status: 'Pending Owner Approval' }] }
      : { items: [] };
    return route.fulfill({ headers, contentType: 'application/json', body: JSON.stringify(data) });
  });
  await page.goto(origin + '/company-overview-test');
  const frame = page.frameLocator('iframe');
  await expect(frame.getByRole('heading', { name: 'Company overview', exact: true })).toBeVisible();
  return { frame, state };
}

test('company overview orders real health sources before the eight-stage customer journey', async ({ page }, testInfo) => {
  const { frame, state } = await mount(page);
  const overview = frame.getByRole('region', { name: 'Company overview', exact: true });
  expect(await overview.locator('.company-health-card h2').allTextContents()).toEqual(['Camera Health', 'InHand Routers', 'Victron power']);
  await expect(overview.getByText('2 field units need review', { exact: true })).toBeVisible();
  await expect(overview.getByText('1 stored router record', { exact: true })).toBeVisible();
  await expect(overview.getByText('Live GPS setup pending', { exact: true })).toBeVisible();
  await expect(overview.getByText('POWER STATUS NOT AVAILABLE IN THIS VIEW', { exact: true })).toBeVisible();
  const lifecycle = overview.getByRole('navigation', { name: 'Company job lifecycle' });
  expect(await lifecycle.locator('strong').allTextContents()).toEqual(['Quote', 'Agreement', 'Signed', 'Schedule & Parts', 'IT Prep', 'Service Install', 'Closeout', 'Billing']);
  await expect(lifecycle.getByRole('button', { name: 'Quote: 2 quotes', exact: true })).toBeVisible();
  await expect(lifecycle.getByRole('button', { name: 'Schedule & Parts: 2 jobs', exact: true })).toBeVisible();
  await expect(lifecycle.getByRole('button', { name: 'Agreement: Not connected', exact: true })).toBeVisible();
  await expect(lifecycle.getByRole('button', { name: 'Signed: Not connected', exact: true })).toBeVisible();
  await lifecycle.getByRole('button', { name: 'Agreement: Not connected', exact: true }).click();
  await expect(overview.getByText('Agreement tracking is not connected.', { exact: true })).toBeVisible();
  const healthBox = await overview.locator('.company-health-grid').boundingBox();
  const stagesBox = await lifecycle.boundingBox();
  const attentionBox = await overview.getByRole('heading', { name: 'What needs attention' }).boundingBox();
  expect(healthBox.y + healthBox.height).toBeLessThan(stagesBox.y);
  expect(stagesBox.y + stagesBox.height).toBeLessThan(attentionBox.y);
  const gridColumns = await lifecycle.evaluate(el => getComputedStyle(el).gridTemplateColumns.split(' ').length);
  expect(gridColumns).toBe(testInfo.project.name.startsWith('mobile') ? 2 : 8);
  const overflow = await frame.locator('body').evaluate(() => ({ width: innerWidth, scrollWidth: document.documentElement.scrollWidth, nodes: [...document.querySelectorAll('body *')].map(el => ({ tag: el.tagName, className: el.className, right: el.getBoundingClientRect().right, left: el.getBoundingClientRect().left })).filter(el => el.right > innerWidth + 1 || el.left < -1).slice(0, 12) }));
  expect(overflow, JSON.stringify(overflow)).toMatchObject({ scrollWidth: overflow.width });
  expect(state.requests.every(item => item.method === 'GET')).toBe(true);
  await frame.locator('body').evaluate(() => scrollTo(0, 0));
  await page.screenshot({ path: testInfo.outputPath('company-overview.png') });
});

test('refresh replaces failed sources with unavailable values and recovers verified zero separately', async ({ page }) => {
  const { frame, state } = await mount(page);
  // Change the fixture only after the initial independent sources have settled.
  await expect(frame.getByText('2 field units need review', { exact: true })).toBeVisible();
  await expect(frame.getByText('1 stored router record', { exact: true })).toBeVisible();
  await expect(frame.getByRole('button', { name: 'Schedule & Parts: 2 jobs', exact: true })).toBeVisible();
  state.failures.add('/api/jobs');
  state.failures.add('/api/camera-health/summary-v3');
  state.failures.add('/api/routers');
  await frame.getByRole('button', { name: 'Refresh Overview', exact: true }).click();
  await expect(frame.getByText('Health unavailable', { exact: true })).toBeVisible();
  await expect(frame.getByText('Router count unavailable', { exact: true })).toBeVisible();
  await expect(frame.getByRole('button', { name: 'Schedule & Parts: Unavailable', exact: true })).toBeVisible();
  await expect(frame.getByText('Nothing currently needs Owner attention in the loaded review sources.', { exact: true })).toHaveCount(0);
  await expect(frame.getByRole('button', { name: 'Quote: 2 quotes', exact: true })).toBeVisible();
  state.failures.clear();
  await frame.getByRole('button', { name: 'Retry dashboard', exact: true }).click();
  await expect(frame.getByText('2 field units need review', { exact: true })).toBeVisible();
  await expect(frame.getByRole('button', { name: 'IT Prep: 0 jobs', exact: true })).toBeVisible();
  await expect(frame.getByRole('button', { name: 'Schedule & Parts: 2 jobs', exact: true })).toBeVisible();
  expect(state.requests.every(item => item.method === 'GET')).toBe(true);
});

test('stage selection keeps the real job search and selected-detail back flow', async ({ page }) => {
  const { frame } = await mount(page);
  await frame.getByRole('button', { name: 'Schedule & Parts: 2 jobs', exact: true }).click();
  const workspace = frame.getByRole('region', { name: 'Daily workspace', exact: true });
  await expect(workspace.getByRole('button', { name: /FIX-101/ })).toBeVisible();
  await expect(workspace.getByRole('button', { name: /FIX-103/ })).toHaveCount(0);
  await workspace.getByRole('searchbox', { name: 'Find an active job' }).fill('FIX-102');
  await expect(workspace.getByRole('button', { name: /FIX-101/ })).toHaveCount(0);
  await workspace.getByRole('button', { name: /FIX-102/ }).click();
  await expect(frame.getByRole('heading', { name: 'Company overview', exact: true })).toHaveCount(0);
  await frame.getByRole('button', { name: /Back to jobs/ }).click();
  await expect(frame.getByRole('heading', { name: 'Company overview', exact: true })).toBeVisible();
  await expect(workspace.getByRole('button', { name: /FIX-102/ })).toBeFocused();
  await frame.locator('body').evaluate(() => history.forward());
  await expect(frame.getByRole('heading', { name: 'Company overview', exact: true })).toHaveCount(0);
  await expect(frame.getByRole('button', { name: /Back to jobs/ })).toBeVisible();
  await frame.locator('body').evaluate(() => history.back());
  await expect(workspace.getByRole('button', { name: /FIX-102/ })).toBeFocused();
  await frame.getByRole('button', { name: 'Billing: 1 job', exact: true }).click();
  await expect(workspace.getByRole('button', { name: /FIX-105/ })).toBeVisible();
  await expect(workspace.getByRole('button', { name: /FIX-102/ })).toHaveCount(0);
  expect(await frame.locator('body').evaluate(() => location.hash)).toContain('#today');
});


test('intermediate-width stage cards preserve all labels, counts and arrows', async ({ page }, testInfo) => {
  for (const width of [701, 768]) {
    await page.setViewportSize({ width, height: 1100 });
    const { frame } = await mount(page);
    const lifecycle = frame.getByRole('navigation', { name: 'Company job lifecycle' });
    await expect(lifecycle.getByRole('button')).toHaveCount(8);
    expect(await lifecycle.evaluate(el => getComputedStyle(el).gridTemplateColumns.split(' ').length)).toBe(4);
    const geometry = await lifecycle.locator('.company-stage').evaluateAll(cards => cards.map(card => ({
      label: card.getAttribute('aria-label'), width: card.clientWidth, content: card.scrollWidth,
      overflowingChildren: [...card.querySelectorAll('strong, .company-stage-total')].filter(child => child.scrollWidth > child.clientWidth).map(child => child.textContent),
    })));
    for (const card of geometry) {
      expect(card.content, width + 'px ' + card.label).toBeLessThanOrEqual(card.width);
      expect(card.overflowingChildren, width + 'px ' + card.label).toEqual([]);
    }
    expect(await frame.locator('body').evaluate(() => document.documentElement.scrollWidth)).toBe(width);
    await page.screenshot({ path: testInfo.outputPath('company-overview-' + width + '.png') });
  }
});

test('approved red eye branding stays readable through responsive navigation and menu dismissal', async ({ page }, testInfo) => {
  for (const width of [320, 375, 390, 700, 768, 1024, 1440]) {
    await page.setViewportSize({ width, height: width <= 700 ? 844 : 1000 });
    const { frame } = await mount(page);
    const brand = frame.locator(width <= 700 ? '.company-mobile-brand' : '.company-brand');
    await expect(brand).toBeVisible();
    await expect(brand.locator('.cos-company-logo')).toHaveAttribute('data-company-logo','full');
    const geometry = await brand.evaluate(el => {
      const image = el.querySelector('.company-eye');
      const style = getComputedStyle(image);
      const rect = image.getBoundingClientRect();
      const box = el.getBoundingClientRect();
      return {
        posters: image.querySelectorAll('img.cos-eye-poster').length,
        canvases: image.querySelectorAll('.cos-eye-live canvas').length,
        label: image.getAttribute('aria-label'), width: rect.width, height: rect.height,
        radius: style.borderRadius, fit: style.objectFit,
        textFits: [...el.querySelectorAll('strong,small')].every(text => text.scrollWidth <= text.clientWidth),
        fits: box.left >= 0 && box.right <= innerWidth,
        background: getComputedStyle(document.body).backgroundColor,
      };
    });
    expect(geometry).toMatchObject({ posters: 1, canvases: 1, label: 'Cameras Onsite', radius: '0px', fit: 'contain', textFits: true, fits: true, background: 'rgb(11, 17, 28)' });
    await expect(brand.locator('.company-eye')).toHaveAttribute('data-eye-ready', 'true');
    await brand.locator('img.cos-eye-poster').evaluateAll(async layers => { await Promise.all(layers.map(image => image.decode())); });
    expect(geometry.width).toBeGreaterThanOrEqual(100);
    expect(geometry.width).toBeLessThanOrEqual(220);
    expect(geometry.width/geometry.height).toBeCloseTo(1490/530,1);
    expect(await frame.locator('body').evaluate(() => document.documentElement.scrollWidth)).toBe(width);
    if ([375, 768, 1440].includes(width)) await page.screenshot({ path: testInfo.outputPath('round-header-' + width + '.png') });
    const more = frame.getByRole('button', { name: 'More', exact: true });
    await more.click();
    const menu = frame.getByRole('dialog', { name: 'Operations navigation' });
    await expect(menu.locator('.company-brand')).toBeVisible();
    await expect(menu.locator('.cos-company-logo')).toHaveAttribute('data-company-logo','full');
    expect(await menu.locator('.company-brand-mark').evaluate(el => getComputedStyle(el).borderRadius)).toBe('0px');
    const close = menu.getByRole('button', { name: 'Close menu' });
    expect((await close.boundingBox()).height).toBeGreaterThanOrEqual(44);
    await page.keyboard.press('Escape');
    await expect(menu).toHaveCount(0);
    await expect(more).toBeFocused();
    await more.click();
    await openWorkspace(frame, 'Jobs');
    await expect(frame.getByRole('heading', { name: 'Job flow', exact: true })).toBeVisible();
    await expect(brand).toBeVisible();
    await frame.locator('body').evaluate(() => history.back());
    await expect(frame.getByRole('heading', { name: 'Company overview', exact: true })).toBeVisible();
  }
});


test('robotic eye scans randomly while sights stay fixed and hidden/reduced-motion eyes pause', async ({ page }) => {
  await page.setViewportSize({ width: 390, height: 844 });
  const { frame } = await mount(page);
  const eye=frame.locator('.company-mobile-brand .company-eye');
  await expect(eye).toHaveAttribute('data-eye-ready','true');await expect(eye).toHaveAttribute('data-motion-paused','false');
  const snapshot=async()=>eye.locator('canvas').evaluate(canvas=>{
    const c=canvas.getContext('2d'),scale=canvas.width/1490;
    return {image:canvas.toDataURL(),sights:[[281,30],[42,261],[489,261],[281,495]].flatMap(([x,y])=>[...c.getImageData(Math.round(x*scale),Math.round(y*scale),1,1).data])};
  });
  const original=await snapshot();await expect.poll(async()=>(await snapshot()).image).not.toBe(original.image);
  expect((await snapshot()).sights).toEqual(original.sights);
  await frame.locator('body').evaluate(()=>{Object.defineProperty(document,'hidden',{configurable:true,value:true});document.dispatchEvent(new Event('visibilitychange'));});
  await expect(eye).toHaveAttribute('data-motion-paused','true');const hidden=await snapshot();await page.waitForTimeout(180);expect(await snapshot()).toEqual(hidden);
  await frame.locator('body').evaluate(()=>{Object.defineProperty(document,'hidden',{configurable:true,value:false});document.dispatchEvent(new Event('visibilitychange'));});
  await expect(eye).toHaveAttribute('data-motion-paused','false');
  await eye.evaluate(el=>el.style.display='none');await expect(eye).toHaveAttribute('data-motion-paused','true');
  await eye.evaluate(el=>el.style.display='');await expect(eye).toHaveAttribute('data-motion-paused','false');
  await page.emulateMedia({reducedMotion:'reduce'});await expect(eye).toHaveAttribute('data-motion-paused','true');
  const still=await snapshot();await page.waitForTimeout(180);expect(await snapshot()).toEqual(still);
  // Inspect the rendered pixels, not only the canvas backing store: Safari's
  // SVG foreignObject bug reports correct bounds but paints a cropped close-up.
  const rendered=(await eye.screenshot({type:'png',scale:'css'})).toString('base64');
  const marks=await eye.evaluate(async(el,png)=>{
    const image=new Image();image.src='data:image/png;base64,'+png;await image.decode();
    const sample=document.createElement('canvas');sample.width=image.width;sample.height=image.height;
    const c=sample.getContext('2d');c.drawImage(image,0,0);
    return [[281,30],[42,261],[489,261],[281,495]].map(([x,y])=>{
      const sx=Math.round(x*image.width/1490),sy=Math.round(y*image.height/530);
      const pixels=c.getImageData(sx-2,sy-2,5,5).data;
      for(let i=0;i<pixels.length;i+=4)if(pixels[i]>=120&&pixels[i+1]>=120&&pixels[i+2]>=120)return true;
      return false;
    });
  },rendered);
  expect(marks).toEqual([true,true,true,true]);
  await page.emulateMedia({reducedMotion:'no-preference'});await expect(eye).toHaveAttribute('data-motion-paused','false');
});

test('advancing operational timers does not replay thousands of eye frames', async ({ page }) => {
  await page.setViewportSize({ width: 390, height: 844 });
  await page.clock.install({ time: new Date(now) });
  const { frame } = await mount(page);
  const eye = frame.locator('.company-mobile-brand .company-eye');
  await expect(eye).toHaveAttribute('data-eye-ready', 'true');
  await expect(eye).toHaveAttribute('data-motion-paused', 'false');
  await eye.locator('canvas').evaluate(canvas => {
    const getContext = canvas.getContext.bind(canvas);
    window.eyeClockProof = { draws: 0, timerFired: false, startedAt: document.timeline.currentTime };
    canvas.getContext = (...args) => { window.eyeClockProof.draws++; return getContext(...args); };
    setTimeout(() => { window.eyeClockProof.timerFired = true; }, 60_000);
  });
  await page.clock.runFor(65_000);
  const proof = await frame.locator('body').evaluate(() => ({
    ...window.eyeClockProof,
    displayedFor: document.timeline.currentTime - window.eyeClockProof.startedAt,
  }));
  expect(proof.timerFired).toBe(true);
  expect(proof.draws).toBeLessThanOrEqual(Math.ceil(proof.displayedFor * 30 / 1000) + 2);
  await expect(eye).toHaveAttribute('data-motion-paused', 'false');
});



test('enlarged eye never overlaps sidebar labels at short desktop heights',async({page},info)=>{
  for(const [width,height] of [[1180,757],[1024,600],[1440,600],[768,600]]){
    await page.setViewportSize({width,height});const{frame}=await mount(page);
    const facts=await frame.locator('.company-brand').evaluate(el=>{const eye=el.querySelector('.company-eye').getBoundingClientRect();const label=document.querySelector('.company-nav-heading').getBoundingClientRect();return{eyeBottom:eye.bottom,labelTop:label.top,brandHeight:el.getBoundingClientRect().height};});
    expect(facts.labelTop).toBeGreaterThan(facts.eyeBottom);expect(facts.brandHeight).toBeGreaterThan(35);
    await page.screenshot({path:info.outputPath('short-sidebar-'+width+'x'+height+'.png')});
  }
});


test('dashboard cards and native Camera Health share source-separated unit totals',async({page})=>{
 const {frame,state}=await mount(page);
 const company=frame.getByRole('region',{name:'Company overview',exact:true}).locator('.company-health-card').filter({hasText:'Camera Health'}),area=frame.getByRole('region',{name:'VISION dashboard'}).getByRole('button',{name:/Camera Health/});
 const systems='Field units: 1 online · 1 offline · 1 need review';
 await expect(company).toContainText(systems);await expect(area).toContainText(systems);await expect(company).toContainText('Camera/detector evidence by unit: 1 online · 1 offline · 1 mixed/unverified · 0 channel status unavailable');await expect(company).toContainText('3 confirmed-field units · 0 location review');
 await area.click();await expect(frame.getByLabel('Fleet status',{exact:true})).toHaveValue('all');await expect(frame.locator('.cos-fleet-table-wrap tbody tr')).toHaveCount(3);await expect(frame.locator('.cos-fleet-stats button strong')).toHaveText(['3','1','1','1','3']);await frame.getByText('Authorized tools',{exact:true}).click();await frame.getByRole('button',{name:'Advanced camera diagnostics',exact:true}).click();await expect.poll(()=>frame.locator('body').evaluate(()=>location.hash)).toBe('#camera-health?diagnostics=1');await expect(frame.locator('.camera-unit-kpis button b')).toHaveText(['3','1','1','1']);expect(state.requests.every(request=>request.method==='GET')).toBe(true);
});

test('legacy health stays unavailable on both dashboards while other metrics remain useful',async({page})=>{
 const {frame}=await mount(page,{cameraData:{...camera,evidenceVersion:1}});
 const company=frame.getByRole('region',{name:'Company overview',exact:true}).locator('.company-health-card').filter({hasText:'Camera Health'}),area=frame.getByRole('region',{name:'VISION dashboard'}).getByRole('button',{name:/Camera Health/});
 await expect(company).toContainText('Health unavailable');await expect(area).toContainText('Health unavailable');await expect(company).not.toContainText('1 online');await expect(area).not.toContainText('1 online');await expect(frame.getByText('1 stored router record',{exact:true})).toBeVisible();await expect(frame.getByRole('button',{name:'Quote: 2 quotes',exact:true})).toBeVisible();
});

test('dashboard provider counts age without issuing fresh reads or inferring offline status',async({page})=>{
 const {frame,state}=await mount(page);
 const area=frame.getByRole('region',{name:'VISION dashboard'}).getByRole('button',{name:/Camera Health/});await expect(area).toContainText('Field units: 1 online · 1 offline · 1 need review');const reads=state.requests.length;
 await page.clock.setFixedTime(new Date(now+16*60000));await frame.locator('body').evaluate(()=>document.dispatchEvent(new Event('visibilitychange')));
 await expect(area).toContainText('Field units: 0 online · 0 offline · 3 need review');await expect(frame.getByRole('region',{name:'Company overview',exact:true})).toContainText('3 field units need review');expect(state.requests.length).toBe(reads);
});
