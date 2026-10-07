import { openWorkspace } from './navigation-helper.mjs';
import { test, expect } from '@playwright/test';
import { auditDarkPresentation } from './dark-presentation-audit.mjs';
import {readFileSync} from 'node:fs';
import { buildSync } from 'esbuild';
import { fileURLToPath } from 'node:url';

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
      : request.path === '/api/camera-health/summary-v2' ? { totalDevices:0, online:0, offline:0, review:0, shopRoot:0, healthRows:0, fieldDevices:0, refreshedAt:stamp, rows:[] }
      : request.path === '/api/daily-board' ? { jobs:[], tasks:[], readiness:[], asOf:stamp }
      : request.path === '/api/field-map' ? { items:[], summary:{fieldUnits:0,mappedUnits:0,unitGps:0,missingGps:0}, generatedAt:stamp }
      : request.path === '/api/owner/control-data' ? { sites:[], truckChecks:[], serviceTechnicians:[], itTechnicians:[] }
      : { items:[] };
    return route.fulfill({ headers, contentType:'application/json', body:JSON.stringify(data) });
  });
  await page.addInitScript(()=>localStorage.setItem('cos-operations-pages-theme','light'));
  await page.goto('/company-platform-fixture');
  const frame = page.frameLocator('iframe');
  await expect(frame.getByText(denied?'ACCESS UNAVAILABLE':'OPERATIONS CONNECTED',{exact:true})).toBeVisible();
  return { frame, requests };
}

test('approved shell is dark with exact desktop proportions and a compact mobile bar', async ({page},testInfo)=>{
  const {frame}=await mount(page);
  await expect(frame.getByRole('heading',{name:'Company overview',exact:true})).toBeVisible();
  const facts=await frame.locator('.company-shell').evaluate(shell=>({theme:document.documentElement.dataset.theme,font:getComputedStyle(shell).fontFamily,bg:getComputedStyle(shell).backgroundColor,sidebar:getComputedStyle(shell.querySelector('.operations-sidebar')).backgroundColor,width:shell.querySelector('.operations-sidebar').getBoundingClientRect().width,bar:shell.querySelector('.company-utility-bar').getBoundingClientRect().height,scroll:document.documentElement.scrollWidth,viewport:innerWidth}));
  expect(facts.theme).toBe('dark');expect(facts.font).toContain('Open Sans');expect(facts.bg).toBe('rgb(17, 27, 42)');expect(facts.sidebar).toBe('rgb(23, 35, 55)');expect(facts.scroll).toBeLessThanOrEqual(facts.viewport+1);
  if(facts.viewport>700){expect(facts.width).toBe(184);expect(facts.bar).toBe(76);await expect(frame.getByRole('navigation',{name:'COS Operations'}).getByRole('button')).toHaveCount(8);}else{await expect(frame.getByRole('navigation',{name:'Mobile Operations navigation'}).getByRole('button')).toHaveCount(4);}
  await page.screenshot({path:testInfo.outputPath('company-approved-shell.png'),fullPage:true});
});
test('Single menu, focus trapping, Escape and return focus work without changing the active route',async({page})=>{
  const {frame}=await mount(page);
  const more=frame.getByRole('button',{name:'More',exact:true});
  await more.click();
  const menu=frame.getByRole('dialog',{name:'Operations navigation'});
  const close=menu.getByRole('button',{name:'Close menu'});
  await expect(close).toBeFocused();
  expect((await auditDarkPresentation(menu)).failures).toEqual([]);
  await expect(menu.getByRole('navigation',{name:'COS Operations'}).getByRole('button')).toHaveCount(8);
  await expect(menu.getByRole('navigation',{name:'COS Operations'}).getByRole('button',{name:'InHand Routers',exact:true})).toBeVisible();
  await expect(menu.getByRole('button',{name:'Customers',exact:true})).toHaveCount(0);
  await close.focus();await close.press('Shift+Tab');
  await expect(menu.getByRole('button',{name:'Sign out',exact:true})).toBeFocused();
  await page.keyboard.press('Tab');await expect(close).toBeFocused();
  await close.press('Escape');await expect(menu).toHaveCount(0);await expect(more).toBeFocused();
  await expect(frame.getByRole('heading',{name:'Company overview',exact:true})).toBeVisible();
});
test('native records forms and load errors remain dark and readable on narrow screens',async({page},testInfo)=>{
  const {frame}=await mount(page);
  await openWorkspace(frame,'Owner Tasks');
  await frame.getByRole('button',{name:'+ New Owner Task',exact:true}).click();
  const input=frame.getByLabel('Task Title *');await expect(input).toBeVisible();
  expect(await input.evaluate(el=>({bg:getComputedStyle(el).backgroundColor,color:getComputedStyle(el).color}))).toEqual({bg:'rgb(17, 27, 42)',color:'rgb(230, 237, 247)'});
  await frame.getByRole('button',{name:'Save task',exact:true}).click();
  await expect(frame.getByRole('alert')).toContainText('Task title is required.');
  expect(await frame.getByRole('alert').evaluate(el=>getComputedStyle(el).color)).toBe('rgb(244, 162, 172)');
  for(const width of [320,390,768,1024,1440]){await page.setViewportSize({width,height:900});const size=await frame.locator('body').evaluate(()=>({width:innerWidth,scroll:document.documentElement.scrollWidth}));expect(size.scroll,'form fits '+width).toBeLessThanOrEqual(size.width+1);}
  expect((await auditDarkPresentation(frame.locator('body'))).failures).toEqual([]);
  await page.screenshot({path:testInfo.outputPath('company-native-form.png'),fullPage:true});
});
test('CSS-only host overlay keeps IT and Service fields readable and hidden workflow gates hidden',async({page})=>{
  await page.route('**/*',route=>route.abort('blockedbyclient'));
  const styles=['../../styles.css','../../vision-platform.css','../../company-host-theme.css'].map(path=>readFileSync(new URL(path,import.meta.url),'utf8')).join('\n');
  await page.setContent(`<meta name="viewport" content="width=device-width,initial-scale=1"><style>${styles}</style><div id="appView"><section id="view-it"><div class="wl-it-command-shell"><aside class="wl-it-command-sidebar"><nav class="wl-it-command-nav"><button class="active">Overview</button></nav></aside><main class="wl-it-command-workspace"><div class="card"><h2>IT preparation</h2><label>Equipment<input value="Fixture equipment"></label><button>Continue check</button></div></main></div><div id="hiddenGate" class="hidden">Unauthorized action</div></section><section id="view-svc"><div id="wlSvcHome"><div class="wl-service-simple-shell"><h1>Service Tech Check</h1><button class="wl-service-action-pill"><b>Truck inspection</b><small>Prepare for today's work</small></button><label>Ticket number<input value="FIX-001"></label></div></div></section></div>`);
  for(const input of await page.locator('input').all()) expect(await input.evaluate(el=>({bg:getComputedStyle(el).backgroundColor,color:getComputedStyle(el).color}))).toEqual({bg:'rgb(17, 27, 42)',color:'rgb(230, 237, 247)'});
  await expect(page.locator('#hiddenGate')).toBeHidden();
  expect(await page.locator('.wl-it-command-sidebar').evaluate(el=>getComputedStyle(el).backgroundColor)).toBe('rgb(23, 35, 55)');
  expect(await page.locator('.wl-service-action-pill').evaluate(el=>getComputedStyle(el).backgroundColor)).toBe('rgb(23, 35, 55)');
});

// The browser canvas must already be dark before the app or CSS downloads finish.
test('dark canvas is declared before scripts and styles load', async ({page}) => {
  await page.route('**/*', route => {
    const type = route.request().resourceType();
    return ['script', 'stylesheet'].includes(type) ? route.abort('blockedbyclient') : route.continue();
  });
  await page.goto('/');
  await expect(page.locator('html')).toHaveAttribute('data-theme', 'dark');
  await expect(page.locator('html')).toHaveCSS('color-scheme', 'dark');
  await expect(page.locator('html')).toHaveCSS('background-color', 'rgb(11, 17, 28)');
});

test('body-portaled prompt placeholders stay readable outside the app root', async ({page}, testInfo) => {
  await page.route('**/*', route => route.abort('blockedbyclient'));
  const styles = ['../src/index.css', '../src/shell.css', '../src/companyTheme.css']
    .map(path => readFileSync(new URL(path, import.meta.url), 'utf8')).join('\n');
  const dialogScript = buildSync({
    entryPoints: [fileURLToPath(new URL('../src/cosDialog.ts', import.meta.url))],
    bundle: true, write: false, platform: 'browser', format: 'iife', globalName: 'CosDialogFixture',
  }).outputFiles[0].text;
  await page.setContent(`<meta name="viewport" content="width=device-width,initial-scale=1"><style>${styles}</style><div id="root"><button id="launch">Open prompt</button></div>`);
  await page.addScriptTag({ content: dialogScript });
  const launcher = page.getByRole('button', { name: 'Open prompt', exact: true });
  const measurements = [];
  for (const [label, tag] of [['Ticket number', 'input'], ['Reason for returning job', 'textarea']]) {
    await page.evaluate(label => {
      document.getElementById('launch').onclick = () => {
        window.promptResult = 'pending';
        void window.CosDialogFixture.cosPrompt(label).then(result => { window.promptResult = result; });
      };
    }, label);
    for (const closeMethod of ['cancel', 'escape']) {
      await launcher.click();
      const dialog = page.getByRole('dialog', { name: label, exact: true });
      const field = dialog.locator(tag);
      await expect(field).toBeFocused();
      const style = await field.evaluate(element => {
        const fieldStyle = getComputedStyle(element), placeholder = getComputedStyle(element, '::placeholder');
        const luminance = color => color.match(/[\d.]+/g).slice(0, 3).map(Number).map(value => value / 255)
          .map(value => value <= .04045 ? value / 12.92 : ((value + .055) / 1.055) ** 2.4)
          .reduce((total, value, index) => total + value * [.2126, .7152, .0722][index], 0);
        const contrast = (a, b) => (Math.max(luminance(a), luminance(b)) + .05) / (Math.min(luminance(a), luminance(b)) + .05);
        return { tag: element.tagName, outsideRoot: element.closest('#root') === null,
          placeholder: placeholder.color, opacity: placeholder.opacity, background: fieldStyle.backgroundColor,
          border: fieldStyle.borderColor, outline: fieldStyle.outlineColor,
          placeholderContrast: contrast(placeholder.color, fieldStyle.backgroundColor),
          borderContrast: contrast(fieldStyle.borderColor, fieldStyle.backgroundColor) };
      });
      expect(style.outsideRoot).toBe(true);
      expect(style.placeholder).toBe('rgb(163, 179, 202)');
      expect(style.opacity).toBe('1');
      expect(style.background).toBe('rgb(17, 27, 42)');
      expect(style.outline).toBe('rgb(145, 176, 255)');
      expect(style.placeholderContrast).toBeGreaterThanOrEqual(4.5);
      expect(style.borderContrast).toBeGreaterThanOrEqual(3);
      measurements.push({ closeMethod, ...style });
      if (closeMethod === 'cancel') {
        await page.screenshot({ path: testInfo.outputPath(`dark-portal-${tag}.png`), fullPage: true });
        await dialog.getByRole('button', { name: 'CANCEL', exact: true }).click();
      } else await field.press('Escape');
      await expect(dialog).toHaveCount(0);
      await expect(launcher).toBeFocused();
      await expect.poll(() => page.evaluate(() => window.promptResult)).toBeNull();
    }
  }
  await testInfo.attach('portal-placeholder-contrast', { body: JSON.stringify(measurements, null, 2), contentType: 'application/json' });
});
