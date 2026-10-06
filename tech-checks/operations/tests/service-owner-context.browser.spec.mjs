import { test, expect } from '@playwright/test';
import { readFileSync, existsSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { resolve, extname } from 'node:path';

const origin = 'http://127.0.0.1:4173';
const repo = resolve(fileURLToPath(new URL('../../..', import.meta.url)));
const legacy = readFileSync(resolve(repo, 'tech-checks/technician-wizard-owner-dashboard-v5.js'), 'utf8');
const section = (start, end) => {
  const from = legacy.indexOf(start), to = legacy.indexOf(end, from);
  if (from < 0 || to <= from) throw new Error('Protected legacy test function was not found');
  return legacy.slice(from, to);
};
// Run the actual protected Service-home render/read functions. Only their data
// client is synthetic. No request reaches a database or a technician account.
const legacyHome = [
  section('function esc(v)', 'function resetWizardPosition'),
  section('async function currentTechIdentity()', 'async function setJobAssignmentStatusCompat'),
  section('async function loadMyServiceTruckReadiness()', 'function serviceTruckUnitOrder'),
  section('async function latestServiceInspectionToday()', 'async function startTrailerInspection'),
  section('async function showSvcHome()', 'function showServiceJobLookup'),
  section('function showServiceJobLookup()', 'async function serviceFindJobByTicket'),
].join('\n');
const sourceHtml = readFileSync(resolve(repo, 'tech-checks/index.html'), 'utf8').replace(/<script\b[^>]*>[\s\S]*?<\/script>/gi, '');
const types = { '.js':'text/javascript', '.css':'text/css', '.png':'image/png', '.svg':'image/svg+xml', '.html':'text/html' };
const fixtureScript = `
  window.fixture = { role:'owner', subject:'fixture-owner', preview:null, mode:'success', calls:[], actions:[] };
  const liveDb = {
    auth: { onAuthStateChange:fn => { fixture.authChanged=fn; return {}; },
      getSession:async()=>({data:{session:fixture.subject?{user:{id:fixture.subject},access_token:'synthetic-only'}:null}}),
      getUser:async()=>({data:{user:{id:fixture.subject}}}) },
    rpc:async(name,args)=>{
      fixture.calls.push({name,args});
      if (fixture.role==='owner'&&!fixture.preview) return {error:{message:'Active Service Tech required.'}};
      if (fixture.mode==='failure') return {error:{message:'Synthetic unavailable'}};
      if (fixture.mode==='pending') return new Promise(resolve=>{fixture.resolve=resolve;});
      return {data:{inspection_ready:true,inventory_ready:true}};
    },
    from:()=>{const query={select:()=>query,eq:()=>query,gte:()=>query,order:()=>query,
      limit:async()=>({data:[{truck_checks:{},taking_trailer:false}]})};return query;}
  };
  function ownerTestPreviewContext(){return fixture.preview;}
  function ownerTestPreviewFor(role){return fixture.preview?.preview_role===role?fixture.preview:null;}
  function resetWizardPosition(){}
  function takeTechCompletion(){return null;}
  function techCompletionBanner(){return '';}
  window.TechCheckContext={db:liveDb,getRole:()=>fixture.role,
    getEffectiveRole:()=>fixture.preview?.preview_role||fixture.role,
    getSession:()=>fixture.subject?{user:{id:fixture.subject}}:null};
  ${legacyHome}
  window.renderServiceHome=showSvcHome;
  window.setIdentity=(role,preview=false)=>{
    fixture.role=role;fixture.subject=role?'fixture-'+role:null;
    fixture.preview=preview?{persona_id:'fixture-persona',preview_role:'service',ticket:'fixture-only'}:null;
    document.body.classList.toggle('owner-test-role-preview',preview);
    document.getElementById('whoRole').textContent=preview||role==='service'?'Service Tech':role==='owner'?'Owner/Admin':'IT Technician';
    document.getElementById('whoName').textContent='Fixture Person';
    document.getElementById('appView').classList.toggle('hidden',!role);
    fixture.authChanged?.('SIGNED_IN',fixture.subject?{user:{id:fixture.subject}}:null);
    dispatchEvent(new CustomEvent('techcheck:data-refreshed'));
  };
  window.show=view=>{
    for (const name of ['owner','it','svc']) document.getElementById('view-'+name).classList.toggle('hidden',name!==view);
    dispatchEvent(new CustomEvent('techcheck:view-changed',{detail:{view}}));
  };
  document.getElementById('sessionLoading').remove();
  document.getElementById('tab-owner').addEventListener('click',()=>show('owner'));
  document.getElementById('tab-svc').addEventListener('click',()=>{show('svc');renderServiceHome();});
  document.addEventListener('click',event=>{
    if (event.target.closest('[data-wl-service-open-job]')) fixture.actions.push('job');
    if (event.target.closest('[data-wl-service-return]')) fixture.actions.push('return');
  });
  setIdentity('owner');show('svc');renderServiceHome();
`;
const html = sourceHtml.replace('</body>', `<script>${fixtureScript}</script><script type="module" src="./operations-host.js"></script></body>`);

async function mount(page) {
  await page.route('**/*', async route => {
    const url = new URL(route.request().url());
    if (url.origin !== origin) return route.abort('blockedbyclient');
    if (url.pathname === '/tech-checks/') return route.fulfill({ contentType:'text/html', body:html });
    const path = resolve(repo, '.' + decodeURIComponent(url.pathname));
    if (path.startsWith(repo + '/') && existsSync(path)) return route.fulfill({ path, contentType:types[extname(path)] || 'application/octet-stream' });
    return route.abort('blockedbyclient');
  });
  await page.goto('/tech-checks/');
  await expect(page.locator('#wlSvcHome')).toBeVisible();
}
const daily = page => page.locator('#wlSvcHome [data-wl-svc="inspect"], #wlSvcHome [data-wl-service-trailer-inspection], #wlSvcHome [data-wl-service-truck-inventory]');

test('shared VISION Service presentation keeps real readiness and job actions readable',async({page},testInfo)=>{
  await mount(page);
  await page.evaluate(async()=>{setIdentity('service');show('svc');await renderServiceHome();});
  const home=page.locator('#wlSvcHome');
  await expect(home.getByRole('button',{name:/Enter Ticket Number/})).toBeVisible();
  await expect(home.getByRole('button',{name:/Truck Inspection/})).toContainText('Completed Today');
  const brand=page.locator('#appView > .mobileTop .cos-vision-brand');
  await expect(brand).toContainText('VISION');
  await expect(brand.locator('img')).toBeVisible();
  for(const width of [320,390,768,1024,1440]){
    await page.setViewportSize({width,height:900});
    const layout=await home.evaluate(element=>({background:getComputedStyle(document.getElementById('appView')).backgroundColor,width:innerWidth,scroll:document.documentElement.scrollWidth,controls:[...element.querySelectorAll('button')].map(button=>{const r=button.getBoundingClientRect();return {left:r.left,right:r.right,height:r.height};})}));
    expect(layout.background).toBe('rgb(11, 17, 28)');
    expect(layout.scroll).toBeLessThanOrEqual(layout.width);
    const samples=await home.locator('h1,.wl-service-help,.wl-service-action-pill b,.wl-service-action-pill small').evaluateAll(elements=>elements.filter(el=>el.getBoundingClientRect().height).map(el=>{
      let surface=el,background=getComputedStyle(surface).backgroundColor;
      while(surface.parentElement&&background==='rgba(0, 0, 0, 0)'){surface=surface.parentElement;background=getComputedStyle(surface).backgroundColor;}
      const lum=color=>{const rgb=color.match(/[\d.]+/g).slice(0,3).map(Number).map(v=>v/255).map(v=>v<=.04045?v/12.92:((v+.055)/1.055)**2.4);return rgb[0]*.2126+rgb[1]*.7152+rgb[2]*.0722};
      const a=lum(getComputedStyle(el).color),b=lum(background);
      return {text:el.textContent,ratio:(Math.max(a,b)+.05)/(Math.min(a,b)+.05)};
    }));
    for(const sample of samples)expect(sample.ratio,JSON.stringify(sample)).toBeGreaterThanOrEqual(4.5);
    if([390,768,1440].includes(width))await page.screenshot({path:testInfo.outputPath(`dark-service-${width}.png`),fullPage:true});
    for(const control of layout.controls){expect(control.height).toBeGreaterThanOrEqual(44);expect(control.left).toBeGreaterThanOrEqual(0);expect(control.right).toBeLessThanOrEqual(layout.width);}
  }
  await home.getByRole('button',{name:/Enter Ticket Number/}).click();
  expect(await page.evaluate(()=>fixture.actions)).toContain('job');
  await home.getByRole('button',{name:/Return Equipment to IT/}).click();
  expect(await page.evaluate(()=>fixture.actions)).toContain('return');
  await page.setViewportSize({width:testInfo.project.use.viewport.width,height:900});
  await page.locator('#appView').screenshot({path:testInfo.outputPath('unified-service.png')});
});

async function expectOwnerNotice(page) {
  await expect(page.locator('#cosOwnerServiceNotice')).toContainText('viewing Service tools as Owner');
  await expect(page.locator('#wlSvcHome')).not.toContainText('Checking today');
  await expect(daily(page)).toHaveCount(3);
  for (const button of await daily(page).all()) {
    await expect(button).toBeDisabled();
    await expect(button).toContainText('Service Tech sign-in required');
    await expect(button).toHaveAttribute('aria-describedby','cosOwnerServiceNotice');
    await expect(button).not.toHaveClass(/complete/);
  }
}

test('Owner Service home explains account requirements after the real legacy RPC rejection', async ({ page }, testInfo) => {
  await mount(page);
  await expectOwnerNotice(page);
  await expect(page.getByRole('note')).toContainText('Daily truck, trailer and inventory checks belong to the signed-in Service Tech');
  await page.locator('#wlSvcHome [data-wl-service-open-job]').click();
  await page.locator('#wlSvcHome [data-wl-service-return]').click();
  expect(await page.evaluate(()=>fixture.actions)).toEqual(['job','return']);
  const calls = await page.evaluate(()=>fixture.calls);
  expect(calls).toEqual([{name:'service_departure_readiness_v1'}]);
  await page.screenshot({path:testInfo.outputPath('owner-service-context.png'),fullPage:true});
  await testInfo.attach('Owner-only Service account notice',{path:testInfo.outputPath('owner-service-context.png'),contentType:'image/png'});
});

test('repeated legacy refreshes and replacement home nodes cannot restore misleading Owner checks', async ({ page }) => {
  await mount(page);
  for (let index=0;index<3;index++) {
    await page.evaluate(async()=>{if(document.getElementById('wlSvcHome')) document.getElementById('wlSvcHome').remove();await renderServiceHome();});
    await expectOwnerNotice(page);
  }
  expect(await page.evaluate(()=>fixture.calls.length)).toBe(4);
  await page.locator('#cosOperationsTechReturn').click();
  await expect(page.locator('#view-owner')).toBeVisible();
  await expect(page.locator('#cosOwnerServiceNotice')).toHaveCount(0);
  await expect(daily(page).first()).toBeEnabled();
  await page.evaluate(()=>document.getElementById('tab-svc').click());
  await expectOwnerNotice(page);
});

test('real Service and owner test-persona renders preserve their original readiness and launch controls', async ({ page }) => {
  await mount(page);
  for (const [role,preview] of [['service',false],['owner',true]]) {
    await page.evaluate(async([role,preview])=>{setIdentity(role,preview);await renderServiceHome();},[role,preview]);
    await expect(page.locator('#cosOwnerServiceNotice')).toHaveCount(0);
    await expect(daily(page).nth(0)).toContainText('Completed Today');
    await expect(daily(page).nth(1)).toContainText('No Trailer Today');
    await expect(daily(page).nth(2)).toContainText('Completed Today');
    for (const button of await daily(page).all()) {
      await expect(button).toBeEnabled();
      await expect(button).toHaveClass(/complete/);
      await expect(button).not.toHaveAttribute('aria-describedby','cosOwnerServiceNotice');
    }
  }
  expect((await page.evaluate(()=>fixture.calls)).at(-1)).toEqual({name:'service_departure_readiness_v1',args:{p_service_tech_id:'fixture-persona'}});
  await page.evaluate(async()=>{setIdentity('owner');await renderServiceHome();});
  await expectOwnerNotice(page);
  await page.evaluate(()=>setIdentity(null));
  await expect(page.locator('#cosOwnerServiceNotice')).toHaveCount(0);
  await expect(daily(page).first()).toBeEnabled();
});

test('a genuine Service readiness failure stays a failure and is never mislabeled an Owner restriction', async ({ page }) => {
  await mount(page);
  await page.evaluate(async()=>{setIdentity('service');fixture.mode='failure';document.getElementById('wlSvcHome').remove();await renderServiceHome();});
  await expect(page.locator('#cosOwnerServiceNotice')).toHaveCount(0);
  await expect(daily(page).first()).toBeEnabled();
  await expect(daily(page).first()).toContainText('Checking today');
  await expect(page.locator('#wlSvcHome .wl-service-help')).toHaveText('Service page is ready. Live status will refresh automatically.');
  expect(await page.evaluate(()=>fixture.calls.length)).toBe(2);
});

test('approved ticket entry forwards to the protected lookup and survives a home refresh',async({page},testInfo)=>{
  await mount(page);
  await page.evaluate(()=>{setIdentity('service');show('svc');return renderServiceHome();});
  await page.addScriptTag({content:readFileSync(resolve(repo,'tech-checks/vision-workspace.js'),'utf8')});
  await expect(page.locator('.vision-ticket-entry')).toHaveCount(1);
  await page.evaluate(()=>renderServiceHome());
  await expect(page.locator('.vision-ticket-entry')).toHaveCount(1);
  await page.getByLabel('Ticket number',{exact:true}).fill('FIX-204');
  await page.screenshot({path:testInfo.outputPath('approved-service.png'),fullPage:true});
  await page.evaluate(()=>{
    window.fixture.lookups=[];
    document.addEventListener('click',event=>{
      if(event.target.closest('[data-wl-service-open-job]'))showServiceJobLookup();
      if(event.target.closest('[data-wl-service-find-job]'))fixture.lookups.push(document.getElementById('wlServiceJobSearch').value);
    });
  });
  await page.getByRole('button',{name:'Open service check →'}).click();
  await expect(page.locator('#wlServiceJobSearch')).toHaveValue('FIX-204');
  expect(await page.evaluate(()=>fixture.lookups)).toEqual(['FIX-204']);
});
