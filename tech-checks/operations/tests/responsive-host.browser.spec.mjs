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

async function mount(page, { vision = false } = {}) {
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
    const data = request.path === '/api/session' ? { authorized:true, name:'Fixture owner', role:'Owner' } : { items:[] };
    return route.fulfill({ headers, contentType:'application/json', body:JSON.stringify(data) });
  });
  await page.goto(appPath);
  await expect(page.locator('#cosOperationsFrame')).toBeVisible();
  if (vision) await page.frameLocator('#cosOperationsFrame').getByRole('button', { name:'Use Vision layout' }).click();
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

async function responsiveLayout(page, frame) {
  await expect(frame.getByText('Connected to COS Operations', { exact:true })).toBeVisible();
  await fillsViewport(page);
  const size = await frame.locator('.vision-header').evaluate(header => ({
    width:innerWidth, content:document.documentElement.scrollWidth, display:getComputedStyle(header).display,
    header:header.getBoundingClientRect().toJSON(),
    options:header.querySelector('.vision-options-toggle').getBoundingClientRect().toJSON(),
  }));
  expect(size.content).toBeLessThanOrEqual(size.width);
  expect(size.display).toBe(size.width >= 901 ? 'grid' : 'block');
  expect(size.options.left).toBeGreaterThanOrEqual(size.header.left);
  expect(size.options.right).toBeLessThanOrEqual(size.header.right);
}

test('the same app link gives the embedded Operations app the full device viewport', async ({ page }, testInfo) => {
  const { frame, requests } = await mount(page);
  const standardLayout = async () => {
    await expect(frame.getByRole('button', { name:'Use Vision layout' })).toBeVisible();
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
  const { frame } = await mount(page, { vision:true });
  await frame.getByRole('navigation', { name:'Vision main sections' }).getByRole('button', { name:'Jobs', exact:true }).click();
  const search = frame.getByRole('searchbox', { name:'Find a job' });
  await search.fill('keep this filter');
  await frame.locator('body').evaluate(() => { window.responsiveFrameMarker = 'same-frame'; });
  for (const [width, height] of [[1440,900], [390,844], [844,390], [320,568], [900,650], [901,650], [1024,768], [1920,1080]]) {
    await page.setViewportSize({ width, height });
    await responsiveLayout(page, frame);
    await expect(search).toHaveValue('keep this filter');
    expect(await frame.locator('body').evaluate(() => location.hash)).toBe('#jobs');
    expect(await frame.locator('body').evaluate(() => window.responsiveFrameMarker)).toBe('same-frame');
  }
});

test('optional VISION preserves the route and can return to the standard workspace', async ({ page }) => {
  const { frame } = await mount(page, { vision:true });
  await frame.getByRole('navigation', { name:'Vision main sections' }).getByRole('button', { name:'Jobs', exact:true }).click();
  await frame.getByRole('button', { name:'Options', exact:true }).click();
  await frame.getByRole('button', { name:'Use classic layout' }).click();
  await expect(frame.getByRole('button', { name:'Use Vision layout' })).toBeVisible();
  expect(await frame.locator('body').evaluate(() => location.hash)).toBe('#jobs');
  await frame.locator('body').evaluate(() => location.reload());
  await expect(frame.getByRole('button', { name:'Use Vision layout' })).toBeVisible();
  await frame.getByRole('button', { name:'Use Vision layout' }).click();
  await responsiveLayout(page, frame);
  expect(await frame.locator('body').evaluate(() => location.hash)).toBe('#jobs');
  expect(await frame.locator('body').evaluate(() => new URLSearchParams(location.search).get('theme'))).toBe('vision');
});

test('existing Owner Tools restore their legacy layout and return to full-width Operations', async ({ page }) => {
  const { frame } = await mount(page, { vision:true });
  await frame.getByRole('button', { name:'Options', exact:true }).click();
  await frame.getByRole('button', { name:'All existing tools' }).click();
  await frame.getByRole('button', { name:'Existing Owner Tools', exact:true }).click();
  await expect(page.locator('body')).toHaveClass(/cos-operations-legacy/);
  await expect(page.locator('#cosOperationsMount')).toBeHidden();
  await expect(page.locator('#cosOperationsLegacy')).toBeVisible();
  await page.locator('#cosOperationsReturn').click();
  await expect(page.locator('#cosOperationsLegacy')).toBeHidden();
  await responsiveLayout(page, frame);
});
