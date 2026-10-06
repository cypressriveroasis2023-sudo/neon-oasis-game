import { test, expect } from '@playwright/test';
import { readFileSync, existsSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { resolve, extname } from 'node:path';

// Presentation-only fixtures: actual page DOM and CSS, with every application
// script removed. All external requests are blocked; no sign-in or mutation runs.
const repo = resolve(fileURLToPath(new URL('../../..', import.meta.url)));
const origin = 'http://127.0.0.1:4173';
const types = { '.css':'text/css', '.png':'image/png', '.jpg':'image/jpeg', '.woff':'font/woff' };
async function mount(page, name) {
  const html = readFileSync(resolve(repo, `tech-checks/${name}.html`), 'utf8')
    .replace(/<script\b[^>]*>[\s\S]*?<\/script>/gi, '');
  await page.route('**/*', route => {
    const url = new URL(route.request().url());
    if (url.origin !== origin) return route.abort('blockedbyclient');
    if (url.pathname === `/tech-checks/${name}.html`) return route.fulfill({contentType:'text/html',body:html});
    const file = resolve(repo, '.' + decodeURIComponent(url.pathname));
    if (file.startsWith(repo + '/') && existsSync(file)) return route.fulfill({path:file,contentType:types[extname(file)] || 'application/octet-stream'});
    return route.abort('blockedbyclient');
  });
  await page.emulateMedia({colorScheme:'light'});
  await page.goto(`/tech-checks/${name}.html`);
  await page.evaluate(() => document.fonts.ready);
  await expect(page.locator('body')).toHaveCSS('font-family', /Open Sans/);
  await expect(page.locator('html')).toHaveCSS('color-scheme', 'dark');
}
async function contained(page, selectors) {
  const overflow = await page.evaluate(selectors => {
    const viewport = innerWidth;
    return selectors.flatMap(selector => [...document.querySelectorAll(selector)].filter(el => {
      const rect = el.getBoundingClientRect(), css = getComputedStyle(el);
      return rect.width && rect.height && css.visibility !== 'hidden' && (rect.left < -1 || rect.right > viewport + 1);
    }).map(el => ({selector, cls:el.className, left:el.getBoundingClientRect().left, right:el.getBoundingClientRect().right})));
  }, selectors);
  expect(overflow).toEqual([]);
  const pageOverflow = await page.evaluate(() => ({ width: innerWidth, scroll: document.documentElement.scrollWidth, offenders: [...document.querySelectorAll('body *')].filter(el => {const r=el.getBoundingClientRect(); return r.width && (r.right>innerWidth+1 || r.left < -1);}).slice(0,12).map(el=>({tag:el.tagName,id:el.id,cls:el.className,right:el.getBoundingClientRect().right})) }));
  expect(pageOverflow.scroll,JSON.stringify(pageOverflow)).toBeLessThanOrEqual(pageOverflow.width+1);
}
async function readable(page, selectors) {
  const results=await page.evaluate(selectors=>{
    const rgb=color=>color.match(/[\d.]+/g).map(Number);
    const luminance=color=>{const values=rgb(color).slice(0,3).map(v=>v/255).map(v=>v<=.04045?v/12.92:((v+.055)/1.055)**2.4);return values[0]*.2126+values[1]*.7152+values[2]*.0722};
    return selectors.flatMap(selector=>[...document.querySelectorAll(selector)].filter(el=>el.getBoundingClientRect().height).map(el=>{
      let surface=el,background=getComputedStyle(surface).backgroundColor;
      while(surface.parentElement && (rgb(background)[3]??1)===0){surface=surface.parentElement;background=getComputedStyle(surface).backgroundColor;}
      const color=getComputedStyle(el).color,a=luminance(color),b=luminance(background);
      const border=getComputedStyle(el).borderTopColor,c=luminance(border);
      return {selector,text:el.textContent.slice(0,45),color,background,ratio:(Math.max(a,b)+.05)/(Math.min(a,b)+.05),field:el.matches('input,select,textarea'),borderRatio:(Math.max(c,b)+.05)/(Math.min(c,b)+.05)};
    }));
  },selectors);
  expect(results.length).toBeGreaterThan(0);
  for(const result of results){expect(result.ratio,JSON.stringify(result)).toBeGreaterThanOrEqual(4.5);if(result.field)expect(result.borderRatio,JSON.stringify(result)).toBeGreaterThanOrEqual(3);}
}

const unit = state => `<article class="unitcard ${state} expanded"><div class="cardtop"><div class="unit-camera-emblem"><span>◎</span></div><div class="unit-heading"><div class="cardtitle">Helios 204</div><div class="card-site">Synthetic inspection site</div><div class="cardmeta"><span class="meta type-chip">HELIOS</span></div></div><div class="unit-status-stack"><span class="statuspill ${state}">${state.toUpperCase()}</span></div></div><div class="unit-health-summary"><div class="uhs up"><b>2</b><span>Online</span></div><div class="uhs down"><b>1</b><span>Offline</span></div><div class="uhs check"><b>0</b><span>Checking</span></div><div class="uhs total"><b>3</b><span>Cameras</span></div></div><div class="unit-time-strip"><div class="time-good"><span>Last successful check</span><b>Oct 6, 10:20 AM</b></div><div class="time-check"><span>Last attempt</span><b>Oct 6, 10:23 AM</b></div></div><div class="component-list"><div class="component camera-detail-link camera-good"><b>Camera 01</b><span class="camera-state-label">ONLINE</span><span class="camera-open-cta">Open camera →</span></div><div class="component camera-detail-link camera-offline"><b>Camera 02</b><span class="camera-state-label">OFFLINE</span><span class="camera-open-cta">Open camera →</span></div><div class="component camera-detail-link camera-issue"><b>Camera 03</b><span class="camera-state-label">CHECKING</span><span class="camera-open-cta">Open camera →</span></div></div><div class="mockup-bottom-actions"><button class="always-trouble">Troubleshoot</button><button class="collapse-toggle">Hide details</button></div></article>`;

test('company tools Camera Health keeps auth, diagnostics and state cues readable', async ({page},testInfo) => {
  await mount(page, 'camera-health');
  await expect(page.locator('#authGate')).toBeVisible();
  await expect(page.locator('#manageUnitsPanel')).toBeHidden();
  await expect(page.locator('#manageUnitsBtn')).toBeHidden();
  await expect(page.locator('.authcard')).toHaveCSS('background-color','rgb(17, 27, 42)');
  await expect(page.locator('#cameraLogin')).toHaveCSS('background-color','rgb(49, 95, 223)');
  await contained(page,['.authcard']);
  await readable(page,['.authcard p','.authcard label','.authcard input','#cameraLogin']);
  await page.evaluate(markup => {
    document.querySelector('#authGate').classList.add('hidden');
    document.querySelector('#unitCards').innerHTML = markup;
    document.querySelector('#unitCards').style.display = 'grid';
  }, unit('online') + unit('offline') + unit('degraded'));
  for (const width of [320,390,768,1024,1440]) {
    await page.setViewportSize({width,height:900});
    await contained(page,['.cos-topline','#unitCards','.unitcard','.cardtop','.component','.mockup-bottom-actions']);
    await expect(page.locator('.cos-topline')).toHaveCSS('background-color','rgb(11, 17, 28)');
    if(width===320 || width===768 || width===1440) await page.locator('.unitcard').first().screenshot({path:testInfo.outputPath(`company-unit-card-${width}.png`)});
    await expect(page.locator('.unitcard.online')).toHaveCSS('background-color','rgb(17, 27, 42)');
    await expect(page.locator('.unitcard.offline .statuspill.offline')).toHaveCSS('color','rgb(244, 162, 172)');
    await expect(page.locator('.unitcard.online .statuspill.online')).toHaveCSS('color','rgb(131, 214, 173)');
    await expect(page.locator('.unitcard.degraded .statuspill.degraded')).toHaveCSS('color','rgb(237, 194, 123)');
    await expect(page.locator('.unitcard .cardtitle').first()).toHaveCSS('color','rgb(230, 237, 247)');
    await readable(page,['.cardtitle','.card-site','.statuspill','.unit-health-summary b','.unit-health-summary span','.camera-state-label','.camera-open-cta','.unit-time-strip b','.unit-time-strip span']);
  }
  await page.evaluate(() => document.body.insertAdjacentHTML('beforeend', '<div class="it-diagnostic-sheet"><section class="it-diagnostic-panel"><h2>IT diagnostics</h2><p class="it-diag-sub">Synthetic unavailable state</p><div class="it-diag-actions"><button>Verify camera</button><button>Check router</button></div><div class="it-diag-result">This result could not be verified. Try again.</div><button class="it-diag-close">Close</button></section></div>'));
  await expect(page.locator('.it-diagnostic-panel')).toHaveCSS('background-color','rgb(17, 27, 42)');
  await page.setViewportSize({width:320,height:800});
  await contained(page,['.it-diagnostic-panel','.it-diag-actions','.it-diag-result']);
  await readable(page,['.it-diagnostic-panel h2','.it-diag-sub','.it-diag-result','.it-diag-actions button']);
  await page.screenshot({path:testInfo.outputPath('company-camera-diagnostics-320.png')});
});

test('company tools Camera Detail retains loading, errors and diagnostic visibility', async ({page},testInfo) => {
  await mount(page, 'camera-detail');
  await expect(page.locator('#loading')).toBeVisible();
  await expect(page.locator('#content')).toBeHidden();
  await expect(page.locator('#error')).toBeHidden();
  await page.evaluate(() => {
    document.querySelector('#loading').classList.add('hidden');
    document.querySelector('#error').textContent='Synthetic connection unavailable. Return to Camera Health.';
    document.querySelector('#error').classList.remove('hidden');
  });
  await expect(page.locator('#error')).toHaveCSS('color','rgb(244, 162, 172)');
  await readable(page,['#error']);
  await page.evaluate(() => {
    document.querySelector('#error').classList.add('hidden');
    document.querySelector('#content').classList.remove('hidden');
    document.querySelector('#cameraName').textContent='Helios 204 · Camera 01';
    document.querySelector('#cameraMeta').textContent='Synthetic site / camera';
    document.querySelector('#lastPing').textContent='No verified live reading';
    document.querySelector('#sourceStatus').textContent='ONLINE';
    document.querySelector('#ports').innerHTML='<span class="port">HTTP 80</span><span class="port off">Port 443 offline</span><span class="port pending">Check pending</span>';
  });
  await expect(page.locator('#siteEditWrap')).toBeHidden();
  await expect(page.locator('#routerSetupWrap')).toBeHidden();
  for(const width of [320,390,768,1024,1440]) {
    await page.setViewportSize({width,height:900});
    await contained(page,['.shell','.toprow','.health-overview','.card','.kv','.ports']);
    await expect(page.locator('.section-card').first()).toHaveCSS('background-color','rgb(17, 27, 42)');
    await expect(page.locator('.port.off')).toHaveCSS('color','rgb(244, 162, 172)');
    await expect(page.locator('.port.pending')).toHaveCSS('color','rgb(237, 194, 123)');
    await readable(page,['#cameraName','#cameraMeta','.section-card>.label','.kv>div','.port','.back']);
    if([390,768,1440].includes(width)) await page.screenshot({path:testInfo.outputPath(`company-camera-detail-${width}.png`),fullPage:true});
  }
  await page.screenshot({path:testInfo.outputPath('company-camera-detail-1440.png'),fullPage:true});
});

test('company tools OnSite Vision keeps loading, conversation and modal states', async ({page},testInfo) => {
  await mount(page,'onsite-vision');
  await expect(page.locator('#visionLoading')).toBeVisible();
  await expect(page.locator('#visionApp')).toBeHidden();
  await expect(page.locator('#visionKnowledgeModal')).toBeHidden();
  await expect(page.locator('#visionLoading')).toHaveCSS('background-color','rgb(17, 27, 42)');
  await expect(page.locator('#visionLoading .vision-eye-stage img')).toHaveAttribute('src','./resources/vision-ai.jpg?v=3');
  await page.evaluate(() => {
    document.querySelector('#visionLoading').classList.add('hidden');
    document.querySelector('#visionApp').classList.remove('hidden');
    document.querySelector('#visionThread').innerHTML='<div class="vision-results"><div class="vision-turn user"><div class="vision-bubble">What needs attention?</div></div><div class="vision-turn assistant"><div class="vision-assistant-head">VISION</div><div class="vision-bubble"><h2 class="vision-answer-title">Review your service order</h2><p class="vision-answer-copy">Synthetic presentation sample. No job data has been read.</p><div class="vision-job-card"><div class="vision-job-head"><b>Installation preparation</b><span class="vision-pill">DRAFT</span></div><div class="vision-direct warn"><b>Needs review</b>Confirm the parts before continuing.</div><div class="vision-action-buttons"><button class="vision-confirm">Confirm action</button><button class="vision-cancel">Cancel</button></div></div><div class="vision-action-card blocked"><small>Blocked action</small><b>Sign-in required</b><p>The original authorization requirement still applies.</p></div></div></div></div>';
  });
  for(const width of [320,390,768,1024,1440]) {
    await page.setViewportSize({width,height:900});
    await contained(page,['.vision-topbar','.vision-main','.vision-composer','.vision-turn','.vision-action-card']);
    await expect(page.locator('.vision-nav-v36 .active')).toHaveCSS('background-color','rgb(32, 52, 86)');
    await expect(page.locator('#visionPrompt')).toHaveCSS('color','rgb(230, 237, 247)');
    await expect(page.locator('.vision-job-card')).toHaveCSS('background-color','rgb(17, 27, 42)');
    await expect(page.locator('.vision-confirm')).toHaveCSS('background-color','rgb(49, 95, 223)');
    await expect(page.locator('.vision-action-card.blocked')).toHaveCSS('color','rgb(237, 194, 123)');
    await readable(page,['.vision-answer-title','.vision-answer-copy','.vision-direct.warn','.vision-pill','.vision-confirm','.vision-cancel','.vision-action-card.blocked p']);
    if([390,768,1440].includes(width)) await page.screenshot({path:testInfo.outputPath(`company-vision-conversation-${width}.png`)});
  }
  await page.screenshot({path:testInfo.outputPath('company-vision-conversation-1440.png')});
  await page.evaluate(() => {document.querySelector('#visionKnowledgeModal').classList.remove('hidden');});
  for(const width of [320,390,768,1024,1440]) {
    await page.setViewportSize({width,height:900});
    await contained(page,['.vision-knowledge-shell','.vision-knowledge-head','.vision-knowledge-editor','.vision-knowledge-actions']);
    await expect(page.locator('#visionKnowledgeDomain')).toHaveCSS('background-color','rgb(17, 27, 42)');
    await expect(page.locator('.vision-knowledge-shell')).toHaveCSS('background-color','rgb(17, 27, 42)');
    await readable(page,['.vision-knowledge-head b','.vision-knowledge-head span','.vision-knowledge-editor label','.vision-knowledge-editor input','.vision-knowledge-editor select','.vision-knowledge-actions button']);
  }
  await page.setViewportSize({width:390,height:844});
  await page.screenshot({path:testInfo.outputPath('company-vision-knowledge-390.png')});
});

test('company tools IT repair keeps sign-in and readiness colors', async ({page},testInfo) => {
  await mount(page,'it-send-repair');
  await expect(page.locator('#login')).toBeVisible();
  await expect(page.locator('#app')).toBeHidden();
  await expect(page.locator('#sign')).toHaveCSS('background-color','rgb(49, 95, 223)');
  await page.evaluate(() => {document.querySelector('#loginMsg').innerHTML='<div class="bad">Username or password is incorrect.</div>';});
  await expect(page.locator('#loginMsg .bad')).toHaveCSS('color','rgb(244, 162, 172)');
  for(const width of [320,390,768,1024,1440]) {
    await page.setViewportSize({width,height:900});
    await contained(page,['.wrap','.hero','#login','input','button']);
    await readable(page,['.hero b','.hero h1','.hero .small','#login h2','#login input','#login button','#loginMsg .bad']);
  }
  await page.setViewportSize({width:390,height:844});
  await page.screenshot({path:testInfo.outputPath('company-it-repair-login-390.png')});
  await page.evaluate(() => {
    document.querySelector('#login').classList.add('hidden');
    document.querySelector('#app').classList.remove('hidden');
    document.querySelector('#tickets').innerHTML='<div class="unit"><b>Synthetic ticket</b><div class="bad">Not ready yet: equipment photo missing.</div><div class="warn">Loading evidence…</div><div class="ok">All required checks complete.</div></div>';
  });
  await expect(page.locator('#tickets .ok')).toHaveCSS('color','rgb(131, 214, 173)');
  await expect(page.locator('#tickets .warn')).toHaveCSS('color','rgb(237, 194, 123)');
  await contained(page,['.unit','.row']);
  await readable(page,['#tickets .ok','#tickets .bad','#tickets .warn']);
});

test('host and tool startup remains dark with light system settings and delayed styles',async({page},testInfo)=>{
  await page.emulateMedia({colorScheme:'light'});
  for(const name of ['index','camera-health','camera-detail','onsite-vision','it-send-repair']){
    const html=readFileSync(resolve(repo,`tech-checks/${name}.html`),'utf8').replace(/<script\b[^>]*>[\s\S]*?<\/script>/gi,'');
    let release;
    const held=new Promise(resolve=>{release=resolve;});
    await page.route('**/*',async route=>{
      const url=new URL(route.request().url());
      if(url.origin!==origin)return route.abort('blockedbyclient');
      if(url.pathname===`/tech-checks/${name}.html`)return route.fulfill({contentType:'text/html',body:html});
      const file=resolve(repo,'.'+decodeURIComponent(url.pathname));
      if(extname(file)==='.css')await held;
      if(file.startsWith(repo+'/')&&existsSync(file))return route.fulfill({path:file,contentType:types[extname(file)]||'application/octet-stream'});
      return route.abort('blockedbyclient');
    });
    try{
      await page.goto(`/tech-checks/${name}.html`,{waitUntil:'commit'});
      await expect(page.locator('meta[name="color-scheme"]')).toHaveAttribute('content','dark');
      // The styles are render-blocking. Dark chrome metadata is parsed before
      // release; the first rendered document must retain the dark canvas.
      await page.waitForTimeout(100);
      release();
      await page.waitForLoadState('load');
      const screenshot=await page.screenshot({path:testInfo.outputPath(`dark-startup-${name}.png`)});
      const pixel=await page.evaluate(async data=>{
        const image=new Image();image.src='data:image/png;base64,'+data;await image.decode();
        const canvas=document.createElement('canvas');canvas.width=image.width;canvas.height=image.height;
        const ctx=canvas.getContext('2d');ctx.drawImage(image,0,0);
        return [...ctx.getImageData(1,1,1,1).data].slice(0,3);
      },screenshot.toString('base64'));
      for(const channel of pixel)expect(channel,`${name} startup pixel ${pixel}`).toBeLessThan(60);
    }finally{release();}
    await page.waitForLoadState('load');
    await page.unrouteAll({behavior:'wait'});
  }
});
