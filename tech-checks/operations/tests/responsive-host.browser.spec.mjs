import { test, expect } from '@playwright/test';
import { readFileSync, existsSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { resolve, extname } from 'node:path';

const origin = 'http://127.0.0.1:4173';
const appPath = '/tech-checks/';
const repo = resolve(fileURLToPath(new URL('../../..', import.meta.url)));
const edge = 'https://tughscoxralhofrckvxy.supabase.co/functions/v1/cos-operations-pages';
// Exercise the real parent DOM, all its CSS and the unchanged auth bridge.
// Only the legacy application scripts/session are replaced with synthetic data.
const parentHtml = readFileSync(resolve(repo, 'tech-checks/index.html'), 'utf8')
  .replace(/<script\b[^>]*>[\s\S]*?<\/script>/gi, '')
  .replace('</body>', `<script>
    document.getElementById('sessionLoading').remove();
    document.getElementById('appView').classList.remove('hidden');
    document.getElementById('view-owner').classList.remove('hidden');
    document.getElementById('view-owner').dataset.ownerRoute='today';
    window.TechCheckContext={getRole:()=> 'owner',getEffectiveRole:()=> 'owner',
      getSession:()=>({user:{id:'fixture-owner'}}),db:{auth:{onAuthStateChange:()=>({}),
      getSession:async()=>({data:{session:{user:{id:'fixture-owner'},access_token:'synthetic-only'}}})}}};
    window.show=()=>{};
    window.ownerAppNavigate=()=>{};
  </script><script type="module" src="./operations-host.js"></script></body>`);
const types = { '.html':'text/html', '.js':'text/javascript', '.css':'text/css', '.svg':'image/svg+xml', '.jpeg':'image/jpeg', '.jpg':'image/jpeg', '.png':'image/png', '.webp':'image/webp' };

async function mount(page) {
  const requests = [];
  await page.route('**/*', async route => {
    const url = new URL(route.request().url());
    if (url.origin === origin) {
      if (url.pathname === appPath) return route.fulfill({ contentType:'text/html', body:parentHtml });
      const path = resolve(repo, '.' + decodeURIComponent(url.pathname));
      if (path.startsWith(repo + '/') && existsSync(path)) return route.fulfill({ path, contentType:types[extname(path)] || 'application/octet-stream' });
      return route.abort('blockedbyclient');
    }
    if (url.href !== edge) return route.abort('blockedbyclient');
    const headers = { 'access-control-allow-origin':origin, 'access-control-allow-methods':'POST, OPTIONS', 'access-control-allow-headers':'authorization, content-type' };
    if (route.request().method() === 'OPTIONS') return route.fulfill({ status:204, headers });
    const request = route.request().postDataJSON();
    requests.push(request);
    expect(request.method).toBe('GET');
    const data = request.path === '/api/routers' ? { items: [], source: 'camera_health', gpsAvailable: false, generatedAt: new Date().toISOString() } : request.path === '/api/session' ? { authorized:true, name:'Fixture owner', role:'Owner' } : { items:[] };
    return route.fulfill({ headers, contentType:'application/json', body:JSON.stringify(data) });
  });
  await page.goto(appPath);
  await expect(page.locator('#cosOperationsFrame')).toBeVisible();
  return { frame:page.frameLocator('#cosOperationsFrame'), requests };
}

async function fillsViewport(page) {
  const dimensions = await page.locator('#cosOperationsFrame').evaluate(frame => {
    const bounds = frame.getBoundingClientRect();
    const owner = document.getElementById('view-owner');
    return { x:bounds.x, y:bounds.y, width:bounds.width, height:bounds.height, outerWidth:innerWidth, outerHeight:innerHeight,
      innerWidth:frame.contentWindow.innerWidth, content:document.documentElement.scrollWidth,
      ownerDisplay:getComputedStyle(owner).display, columns:getComputedStyle(owner).gridTemplateColumns };
  });
  console.log('Actual parent and iframe dimensions:', JSON.stringify(dimensions));
  expect(dimensions.x).toBe(0);
  expect(dimensions.y).toBe(0);
  expect(dimensions.width).toBe(dimensions.outerWidth);
  expect(dimensions.innerWidth).toBe(dimensions.outerWidth);
  expect(dimensions.height).toBe(dimensions.outerHeight);
  expect(dimensions.content).toBeLessThanOrEqual(dimensions.outerWidth);
  await expect(page.locator('#appView>.mobileTop')).toBeHidden();
}

test('shared Operations menu opens tools, loads a workspace and closes with Escape', async ({ page }, testInfo) => {
  const { frame, requests } = await mount(page);
  const more=frame.getByRole('button',{name:'More',exact:true});
  await more.click();
  const menu=frame.getByRole('dialog',{name:'Operations navigation'});
  await expect(menu).toBeVisible();
  await responsiveLayout(page,frame);
  await expect(menu.getByRole('button',{name:'Close menu'})).toBeFocused();
  await menu.getByRole('navigation',{name:'COS Operations',exact:true}).getByRole('button',{name:'Tech Check',exact:true}).click();
  await expect(menu).toHaveCount(0);
  await expect(frame.getByRole('region',{name:'Tech Check workspaces'})).toBeVisible();
  expect(await frame.locator('body').evaluate(()=>location.hash)).toBe('#tech-check');
  await more.click();
  await frame.getByRole('dialog',{name:'Operations navigation'}).screenshot({path:testInfo.outputPath('unified-menu.png')});
  await frame.getByRole('button',{name:'Close menu'}).press('Escape');
  await expect(menu).toHaveCount(0);
  await expect(more).toBeFocused();
  await expect(frame.getByRole('region',{name:'Tech Check workspaces'})).toBeVisible();
  const sizes=await frame.locator('body').evaluate(()=>({viewport:innerWidth,content:document.documentElement.scrollWidth}));
  expect(sizes.content).toBeLessThanOrEqual(sizes.viewport);
  await frame.locator('.operations-shell').screenshot({path:testInfo.outputPath('unified-operations.png')});
  await frame.getByRole('button',{name:'Switch to light mode'}).click();
  const light=await frame.locator('.command-page-header').evaluate(element=>({background:getComputedStyle(element).backgroundColor,text:getComputedStyle(element.querySelector('h1')).color}));
  expect(light.background).toBe('rgb(255, 255, 255)');expect(light.text).toBe('rgb(21, 36, 54)');
  await frame.getByRole('button',{name:'Switch to dark mode'}).click();
  expect(requests.every(request=>request.method==='GET')).toBe(true);
});

async function responsiveLayout(page, frame) {
  await expect(frame.getByText('OPERATIONS CONNECTED', { exact:true })).toBeVisible();
  await fillsViewport(page);
  await expect(frame.getByRole('button',{name:'More',exact:true})).toBeVisible();
  const size = await frame.locator('.owner-it-topbar').evaluate(header => {
    const main=header.parentElement, style=getComputedStyle(main);
    return {width:innerWidth,content:document.documentElement.scrollWidth,
      main:main.getBoundingClientRect().toJSON(),header:header.getBoundingClientRect().toJSON(),
      padding:parseFloat(style.paddingLeft)+parseFloat(style.paddingRight),
      menu:header.querySelector('.operations-open-menu').getBoundingClientRect().toJSON()};
  });
  expect(size.content).toBeLessThanOrEqual(size.width);
  expect(size.main.width).toBeCloseTo(size.width-(size.width>700?104:0),0);
  expect(size.header.width).toBeCloseTo(size.main.width-size.padding,0);
  if(size.width>700){
    expect(size.menu.left).toBeGreaterThanOrEqual(size.header.left);
    expect(size.menu.right).toBeLessThanOrEqual(size.header.right);
  }else{
    await expect(frame.getByRole('navigation',{name:'Mobile Operations navigation'}).getByRole('button',{name:'Office',exact:true})).toBeVisible();
  }
  await expect(frame.getByRole('button',{name:/Use (classic|Vision) layout/i})).toHaveCount(0);
}

test('the same app link gives the embedded Operations app the full device viewport', async ({ page }, testInfo) => {
  const { frame, requests } = await mount(page);
  const standardLayout = async () => {
    await expect(frame.getByRole('button', { name:/Use (classic|Vision) layout/i })).toHaveCount(0);
    await expect(frame.getByRole('navigation', { name:'Vision main sections' })).toHaveCount(0);
    await fillsViewport(page);
    const desktop = page.viewportSize().width > 700;
    const sidebar = frame.getByRole('complementary', { name:'Operations navigation' });
    const mobileNav = frame.getByRole('navigation', { name:'Mobile Operations navigation' });
    if (desktop) { await expect(sidebar).toBeVisible(); await expect(mobileNav).toBeHidden(); }
    else { await expect(sidebar).toBeHidden(); await expect(mobileNav).toBeVisible(); }
  };
  await standardLayout();
  await page.screenshot({ path:testInfo.outputPath('actual-parent.png'), fullPage:true });
  await testInfo.attach('Default responsive Operations', { path:testInfo.outputPath('actual-parent.png'), contentType:'image/png' });
  await page.reload();
  await standardLayout();
  expect(new URL(page.url()).pathname).toBe(appPath);
  expect(new URL(page.url()).search).toBe('');
  expect(requests.every(request => request.method === 'GET')).toBe(true);
});

test('rotation and desktop resizing preserve the same frame, route and in-progress input', async ({ page }) => {
  const { frame } = await mount(page);
  await frame.getByRole('button',{name:'More',exact:true}).click();
  await frame.getByRole('dialog',{name:'Operations navigation'}).getByRole('button',{name:'Jobs',exact:true}).click();
  const search = frame.getByRole('searchbox', { name:'Find a job' });
  await search.fill('keep this filter');
  await frame.locator('body').evaluate(() => { window.responsiveFrameMarker = 'same-frame'; });
  for (const [width, height] of [[1440,900], [390,844], [844,390], [320,568], [900,650], [901,650], [1024,768], [1920,1080], [2560,1440]]) {
    await page.setViewportSize({ width, height });
    await responsiveLayout(page, frame);
    await expect(search).toHaveValue('keep this filter');
    expect(await frame.locator('body').evaluate(() => location.hash)).toBe('#jobs');
    expect(await frame.locator('body').evaluate(() => window.responsiveFrameMarker)).toBe('same-frame');
  }
});

test('old VISION bookmarks preserve route, other query parameters and color preference', async ({ page }) => {
  const { frame, requests } = await mount(page);
  await frame.getByRole('button',{name:'Switch to light mode'}).click();
  await frame.locator('body').evaluate(()=>{location.href=location.pathname+'?theme=vision&source=saved-link#jobs';});
  await expect(frame.getByRole('heading',{name:'Jobs',exact:true})).toBeVisible();
  await expect(frame.getByRole('button',{name:'Switch to dark mode'})).toBeVisible();
  await responsiveLayout(page,frame);
  expect(await frame.locator('body').evaluate(()=>location.search+location.hash)).toBe('?source=saved-link#jobs');
  await frame.locator('body').evaluate(()=>location.reload());
  await expect(frame.getByRole('heading',{name:'Jobs',exact:true})).toBeVisible();
  await responsiveLayout(page,frame);
  expect(await frame.locator('body').evaluate(()=>location.search+location.hash)).toBe('?source=saved-link#jobs');
  expect(requests.every(request=>request.method==='GET')).toBe(true);
});

test('existing Owner Tools restore their legacy layout and return to full-width Operations', async ({ page }) => {
  const { frame } = await mount(page);
  await frame.getByRole('button', { name:'More', exact:true }).click();
  await frame.getByRole('button', { name:'Existing Owner Tools', exact:true }).click();
  await expect(page.locator('body')).toHaveClass(/cos-operations-legacy/);
  await expect(page.locator('#cosOperationsMount')).toBeHidden();
  await expect(page.locator('#cosOperationsLegacy')).toBeVisible();
  await page.locator('#cosOperationsReturn').click();
  await expect(frame.getByRole('dialog',{name:'Operations navigation'})).toHaveCount(0);
  await expect(page.locator('#cosOperationsLegacy')).toBeHidden();
  await responsiveLayout(page, frame);
});

test('approved Today workspace uses the available screen width at normal browser zoom', async ({ page }, testInfo) => {
  const { frame } = await mount(page);
  await responsiveLayout(page, frame);
  await expect(frame.locator('.owner-command-home')).toHaveAttribute('aria-busy','false');
  const layout=await frame.locator('.workspace-overview').evaluate(today=>({
    zoom:visualViewport.scale, today:today.getBoundingClientRect().toJSON(),
    header:document.querySelector('.owner-it-topbar').getBoundingClientRect().toJSON(),
    work:today.querySelector('.workspace-work').getBoundingClientRect().toJSON(),
    details:today.querySelector('.workspace-detail').getBoundingClientRect().toJSON()
  }));
  expect(layout.zoom).toBe(1);
  expect(layout.today.width).toBeCloseTo(layout.header.width,0);
  for(const section of page.viewportSize().width>700?[layout.work,layout.details]:[layout.work]){
    expect(section.left).toBeGreaterThanOrEqual(layout.today.left);
    expect(section.right).toBeLessThanOrEqual(layout.today.right+1);
  }
  await page.screenshot({path:testInfo.outputPath('approved-fluid-screen.png'),fullPage:true});
});
