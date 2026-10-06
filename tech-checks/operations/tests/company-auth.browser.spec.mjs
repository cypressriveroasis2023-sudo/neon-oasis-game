import { test, expect } from '@playwright/test';
import { readFileSync, existsSync } from 'node:fs';
import { resolve, extname } from 'node:path';
import { fileURLToPath } from 'node:url';

const origin='http://127.0.0.1:4173';
const repo=resolve(fileURLToPath(new URL('../../..',import.meta.url)));
const hostHtml=readFileSync(resolve(repo,'tech-checks/index.html'),'utf8').replace(/<script\b[^>]*>[\s\S]*?<\/script>/gi,'');
const mime={'.css':'text/css','.svg':'image/svg+xml','.jpg':'image/jpeg','.png':'image/png','.woff':'font/woff'};
const requiredStyles=['styles.css','vision-platform.css','company-host-theme.css'];
for(const name of requiredStyles) {
  if(!hostHtml.includes(name)) throw new Error('Actual host must include '+name);
  readFileSync(resolve(repo,'tech-checks',name),'utf8');
}
function contrast(a,b){const luminance=color=>{const rgb=color.match(/[\d.]+/g).slice(0,3).map(Number).map(v=>v/255).map(v=>v<=.04045?v/12.92:((v+.055)/1.055)**2.4);return rgb[0]*.2126+rgb[1]*.7152+rgb[2]*.0722};const x=luminance(a),y=luminance(b);return(Math.max(x,y)+.05)/(Math.min(x,y)+.05)}
async function mountHost(page){
  const seen=new Set();
  await page.route('**/*',route=>{
    const url=new URL(route.request().url());
    if(url.origin!==origin)return route.abort('blockedbyclient');
    if(url.pathname==='/tech-checks/')return route.fulfill({contentType:'text/html',body:hostHtml});
    const path=resolve(repo,'.'+decodeURIComponent(url.pathname));
    if(!path.startsWith(repo+'/')||!existsSync(path)||!mime[extname(path)])return route.abort('blockedbyclient');
    seen.add(url.pathname.split('/').pop());
    return route.fulfill({path,contentType:mime[extname(path)]});
  });
  await page.goto('/tech-checks/');
  for(const name of requiredStyles)expect(seen.has(name)).toBe(true);
  await expect(page.locator('script')).toHaveCount(0);
  for(const id of ['authView','forcePasswordView','appView','resetRequestCard','resetStatusButton','resetTempBox'])await expect(page.locator('#'+id)).toBeHidden();
  return seen;
}
async function showState(page,state){
  await page.evaluate(state=>{
    document.getElementById('sessionLoading')?.remove();
    document.getElementById('authView').classList.toggle('hidden',state==='forced');
    document.getElementById('forcePasswordView').classList.toggle('hidden',state!=='forced');
    document.getElementById('resetRequestCard').classList.toggle('hidden',state!=='reset');
  },state);
}
async function readable(locator,background){
  const style=await locator.evaluate(el=>({text:getComputedStyle(el).color,background:getComputedStyle(el).backgroundColor}));
  expect(contrast(style.text,background||style.background)).toBeGreaterThanOrEqual(4.5);
  return style;
}
for(const width of [320,390,701,1024,1440])test('real host authentication surfaces stay dark and contained at '+width,async({page},testInfo)=>{
  await page.setViewportSize({width,height:1000});
  await page.emulateMedia({colorScheme:'light'});
  await mountHost(page);
  await expect(page.locator('html')).toHaveCSS('color-scheme','dark');
  await expect(page.locator('#sessionLoading')).toHaveCSS('background-color','rgb(11, 17, 28)');
  await readable(page.locator('.visionLaunchStatus'),'rgb(11, 17, 28)');
  for(const state of ['signin','reset','forced']){
    await showState(page,state);
    const view=page.locator(state==='forced'?'#forcePasswordView':'#authView');
    await expect(view).toBeVisible();
    await expect(page.locator('#sessionLoading')).toHaveCount(0);
    const hero=view.locator('.hero');
    expect(await hero.evaluate(el=>getComputedStyle(el).backgroundColor)).toBe('rgb(17, 27, 42)');
    await readable(view.locator('.cos-vision-brand strong'),'rgb(17, 27, 42)');
    await readable(view.locator('.cos-vision-brand small'),'rgb(17, 27, 42)');
    for(const card of await view.locator('.card:visible').all()){
      expect(await card.evaluate(el=>getComputedStyle(el).backgroundColor)).toBe('rgb(17, 27, 42)');
      for(const heading of await card.locator('h2,h3').all())await readable(heading,'rgb(17, 27, 42)');
    }
    for(const input of await view.locator('input:visible').all()){
      const style=await readable(input);expect(style.background).toBe('rgb(17, 27, 42)');
      const border=await input.evaluate(el=>getComputedStyle(el).borderTopColor);expect(contrast(border,style.background)).toBeGreaterThanOrEqual(3);
      await input.focus();expect(await input.evaluate(el=>getComputedStyle(el).outlineColor)).toBe('rgb(145, 176, 255)');
    }
    for(const button of await view.locator('.btn:visible').all()){
      const style=await readable(button);expect(style.background).toBe('rgb(49, 95, 223)');expect(style.text).toBe('rgb(255, 255, 255)');
    }
    for(const secondary of await view.locator('.mini:visible').all())await readable(secondary);
    for(const id of ['appView','resetStatusButton','resetTempBox'])await expect(page.locator('#'+id)).toBeHidden();
    const size=await page.evaluate(()=>({width:innerWidth,scroll:document.documentElement.scrollWidth}));expect(size.scroll).toBeLessThanOrEqual(size.width+1);
    await page.screenshot({path:testInfo.outputPath(`real-auth-${state}-${width}.png`),fullPage:true});
  }
});

// Exercise the real signed-out React boundary; the only backend response is a
// denied synthetic session. No credentials or production data are used.
test('signed-out IT and Service tile subtitles have accessible contrast',async({page})=>{
  const edge='https://tughscoxralhofrckvxy.supabase.co/functions/v1/cos-operations-pages';
  await page.route('**/*',route=>{
    const url=route.request().url();
    if(url===origin+'/denied-auth-fixture')return route.fulfill({contentType:'text/html',body:`<meta name="viewport" content="width=device-width,initial-scale=1"><style>body{margin:0}iframe{width:100%;height:100vh;border:0}</style><iframe src="/"></iframe><script>addEventListener('message',e=>{if(e.origin===location.origin&&e.data.type==='COS_OPERATIONS_TOKEN_REQUEST')e.source.postMessage({type:'COS_OPERATIONS_TOKEN_RESPONSE',requestId:e.data.requestId,role:'owner',accessToken:'synthetic-only'},location.origin)})</script>`});
    if(url.startsWith(origin+'/'))return route.continue();
    if(url!==edge)return route.abort('blockedbyclient');
    const headers={'access-control-allow-origin':origin,'access-control-allow-methods':'POST, OPTIONS','access-control-allow-headers':'authorization, content-type'};
    if(route.request().method()==='OPTIONS')return route.fulfill({status:204,headers});
    expect(route.request().postDataJSON().path).toBe('/api/session');
    return route.fulfill({headers,contentType:'application/json',body:JSON.stringify({authorized:false,reason:'Synthetic access boundary'})});
  });
  await page.goto('/denied-auth-fixture');
  const frame=page.frameLocator('iframe');await expect(frame.getByRole('heading',{name:'Operations access needs attention'})).toBeVisible();
  for(const button of await frame.locator('.operations-tool-grid>button').all()){
    const bg=await button.evaluate(el=>getComputedStyle(el).backgroundColor);
    await readable(button.locator('b'),bg);await readable(button.locator('span'),bg);
  }
});

const legacy=readFileSync(resolve(repo,'tech-checks/technician-wizard-owner-dashboard-v5.js'),'utf8');
function legacySection(start,end){
  const from=legacy.indexOf(start),to=legacy.indexOf(end,from);
  if(from<0||to<=from)throw new Error('Legacy presentation section missing: '+start);
  return legacy.slice(from,to);
}
const legacyPresentation=[
  legacySection('function esc(v)','function resetWizardPosition'),
  legacySection('function injectStyles()','function progress('),
  legacySection('function ensureTechMenuPanel()','async function maybeShowFirstTimeWalkthrough()'),
  legacySection('function ensureITCommandDashboardStyles()','function startITCommandClockWeather()'),
].join('\n');

async function mountLegacyPresentation(page){
  await mountHost(page);
  // Run the protected menu/dashboard renderers and their real injected CSS,
  // with empty synthetic data and no database, weather, auth or action handlers.
  await page.evaluate(source=>{
    new Function(`${source}
      const currentRoleKey=()=>window.fixtureRole||'it';
      const pushAlertState=async()=>null;
      const resetWizardPosition=()=>{};
      const techDashboardLoadingHtml=label=>'<div class="small">'+label+'</div>';
      const techDashboardErrorHtml=(role,error)=>{throw new Error(error);};
      const techDashboardTimeout=value=>value;
      const itDayState=async()=>({currentAssignments:[],waitingReturns:[],truckRestockQueue:[],serviceQueue:[],drafts:[]});
      const loadITManagedTickets=async()=>[];
      const takeTechCompletion=()=>null;
      const techCompletionBanner=()=>'';
      const techCheckDateKey=()=> '2026-10-06';
      const itNextActionHtml=()=>'<div class="small">Synthetic empty work queue</div>';
      const itServiceQueueHtml=()=>'';
      const startITCommandClockWeather=()=>{};
      injectStyles();
      window.renderDarkMenu=openTechMenu;
      window.renderDarkIT=showITHome;
    `)();
    document.getElementById('sessionLoading').remove();
    document.getElementById('appView').classList.remove('hidden');
    document.getElementById('view-it').classList.remove('hidden');
    document.getElementById('whoRole').textContent='IT Technician';
    document.getElementById('whoName').textContent='Synthetic Technician';
  },legacyPresentation);
}
async function readableOnSurface(locator){
  for(const item of await locator.all()){
    if(!await item.isVisible())continue;
    const background=await item.evaluate(el=>{
      for(let node=el;node;node=node.parentElement){const color=getComputedStyle(node).backgroundColor;if(color!=='rgba(0, 0, 0, 0)')return color;}
      return 'rgb(11, 17, 28)';
    });
    await readable(item,background);
  }
}

test('real injected IT dashboard and native question surfaces remain dark',async({page},testInfo)=>{
  await mountLegacyPresentation(page);
  await page.evaluate(()=>renderDarkIT());
  await expect(page.locator('#view-it .wl-it-command-shell')).toBeVisible();
  for(const width of [320,390,768,1440]){
    await page.setViewportSize({width,height:1000});
    await expect(page.locator('#view-it .wl-it-command-shell')).toHaveCSS('background-color','rgb(17, 27, 42)');
    await readableOnSurface(page.locator('.wl-it-command-shell h1,.wl-it-command-shell h2,.wl-it-command-stats span,.wl-it-command-stats small,.wl-it-readiness-actions b,.wl-it-readiness-actions span,.wl-it-empty,.wl-it-quick-grid b,.wl-it-quick-grid span'));
    expect(await page.evaluate(()=>document.documentElement.scrollWidth)).toBeLessThanOrEqual(width+1);
    await page.screenshot({path:testInfo.outputPath(`dark-it-dashboard-${width}.png`),fullPage:true});
  }
  await page.evaluate(()=>{
    document.querySelector('#wlItHome').innerHTML='<div class="wl-head"><div class="kicker">IT READINESS</div><h2>Equipment check</h2></div><div class="wl-question"><div class="qnum">Required step</div><div class="qtext">Is the camera recording?</div><div class="wl-options"><button class="pass on">Yes, verified</button><button class="fail">No, needs work</button></div><div class="wl-proof"><div class="wl-note">Keep the required evidence attached.</div></div></div><div class="wl-stop"><b>Release blocked</b><div class="small">Required evidence is missing.</div></div><div class="wl-history"><details class="wl-status-complete" open><summary>Completed check</summary><div class="body">Verified synthetic state</div></details><details class="wl-status-waiting"><summary>Waiting for a check</summary></details></div>';
  });
  for(const selector of ['.wl-head','.wl-question','.wl-proof']) await expect(page.locator(selector)).toHaveCSS('background-color','rgb(17, 27, 42)');
  await readableOnSurface(page.locator('.wl-head h2,.qnum,.qtext,.wl-options button,.wl-note,.wl-stop b,.wl-stop .small,.wl-history summary'));
  await page.screenshot({path:testInfo.outputPath('dark-native-question.png'),fullPage:true});
});

test('real dynamically injected owner and technician menus keep dark readable dialogs',async({page},testInfo)=>{
  await mountLegacyPresentation(page);
  for(const role of ['it','service','owner']){
    await page.evaluate(async role=>{window.fixtureRole=role;await renderDarkMenu();},role);
    const panel=page.locator('#wlTechMenuPanel');
    for(const width of [320,390,768,1440]){
      await page.setViewportSize({width,height:1000});
      await expect(panel.locator('.wl-menu-sheet')).toHaveCSS('background-color','rgb(17, 27, 42)');
      await readableOnSurface(panel.locator('h2,b,small,.wl-menu-section-label'));
      expect(await page.evaluate(()=>document.documentElement.scrollWidth)).toBeLessThanOrEqual(width+1);
      if(width===390||width===1440)await page.screenshot({path:testInfo.outputPath(`dark-native-menu-${role}-${width}.png`)});
    }
    await page.evaluate(()=>document.getElementById('wlTechMenuPanel').classList.add('hidden'));
    await expect(panel).toBeHidden();
  }
});
