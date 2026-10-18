import { test, expect } from '@playwright/test';
import { readFileSync, existsSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { resolve, extname } from 'node:path';
const repo = resolve(fileURLToPath(new URL('../../..', import.meta.url)));
const origin = 'http://127.0.0.1:4173';
const types = { '.css':'text/css', '.js':'text/javascript', '.png':'image/png', '.jpg':'image/jpeg', '.woff':'font/woff', '.svg':'image/svg+xml' };

async function mount(page, name) {
  let html = readFileSync(resolve(repo, 'tech-checks/' + name + '.html'), 'utf8').replace(/<script\b[^>]*>[\s\S]*?<\/script>/gi, '');
  html = html.replace('</head>', '<style>*{transition:none!important}</style><link rel="stylesheet" href="./cos-eye-branding.css"><script defer src="./cos-eye-branding.js"></script></head>');
  await page.route('**/*', route => {
    const url = new URL(route.request().url());
    if (url.origin !== origin) return route.abort('blockedbyclient');
    if (url.pathname === '/tech-checks/' + name + '.html') return route.fulfill({ contentType:'text/html', body:html });
    const file = resolve(repo, '.' + decodeURIComponent(url.pathname));
    if (file.startsWith(repo + '/') && existsSync(file)) return route.fulfill({ path:file, contentType:types[extname(file)] || 'application/octet-stream' });
    return route.abort('blockedbyclient');
  });
  await page.goto('/tech-checks/' + name + '.html');
  await page.evaluate(() => document.fonts.ready);
}

async function checkEyes(page) {
  const eyes=page.locator('.cos-static-eye:visible');
  expect(await eyes.count()).toBeGreaterThan(0);
  await expect.poll(()=>eyes.evaluateAll(nodes=>nodes.every(el=>el.dataset.eyeReady==='true'))).toBe(true);
  const values=await eyes.evaluateAll(nodes=>nodes.map(el=>{
    const r=el.getBoundingClientRect(),canvas=el.querySelector('canvas');
    const live=canvas.getBoundingClientRect();
    return {full:el.dataset.companyLogo==='full',width:r.width,height:r.height,canvasWidth:live.width,canvasHeight:live.height,housing:getComputedStyle(el.querySelector('.cos-eye-housing')).transform,
      canvases:el.querySelectorAll('canvas').length,pixels:canvas.width,left:r.left,right:r.right,viewport:innerWidth};
  }));
  for(const v of values.filter(v=>v.right>0&&v.left<v.viewport)){
    expect(v.width).toBeGreaterThanOrEqual(16);expect(v.height).toBeCloseTo(v.full?v.width*530/1490:v.width,1);
    expect(v.housing).toBe('none');expect(v.canvases).toBe(1);expect(v.pixels).toBeLessThanOrEqual(512);
    expect(v.canvasWidth).toBeCloseTo(v.width,1);expect(v.canvasHeight).toBeCloseTo(v.height,1);
    expect(v.left).toBeGreaterThanOrEqual(-1);expect(v.right).toBeLessThanOrEqual(v.viewport+1);
  }
}

for (const name of ['index','camera-health','camera-detail','it-send-repair','onsite-vision']) {
  test('shared moving eye covers '+name+' without replacing application controls',async({page},info)=>{
    await mount(page,name);
    if(name==='index')await page.evaluate(()=>{document.getElementById('sessionLoading')?.remove();document.body.className='';document.getElementById('authView')?.classList.remove('hidden');});
    if(name==='camera-health')await page.evaluate(()=>document.getElementById('authGate')?.classList.add('hidden'));
    if(name==='onsite-vision')await page.evaluate(()=>{
      document.getElementById('visionLoading')?.classList.add('hidden');document.getElementById('visionApp')?.classList.remove('hidden');
      document.getElementById('visionThread').innerHTML='<div class="vision-welcome vision-welcome-minimal vision-welcome-v36"><button type="button" class="vision-orb vision-orb-v36" aria-label="Talk to OnSite Vision"><span class="vision-eye-stage"><img src="./resources/vision-ai.jpg?v=2" alt="OnSite Vision AI"></span></button><div class="vision-assistant-head"><img src="./resources/vision-ai.jpg" alt=""> ONSITE VISION</div></div>';
    });
    for(const width of [320,390,768,1440]){
      await page.setViewportSize({width,height:900});await checkEyes(page);
      if(width===390||width===1440)await page.screenshot({path:info.outputPath(name+'-'+width+'.png')});
    }
    if(name==='camera-detail'){await expect(page.locator('#backBtn')).toBeVisible();await expect(page.locator('#verifyBtn')).toBeVisible();}
    if(name==='it-send-repair')await expect(page.locator('#sign')).toBeVisible();
    if(name==='onsite-vision'){await expect(page.getByRole('button',{name:'Talk to OnSite Vision',exact:true})).toBeVisible();await expect(page.locator('#visionPrompt')).toHaveCount(1);await page.getByRole('button',{name:'Talk to OnSite Vision',exact:true}).click();}
    await page.emulateMedia({reducedMotion:'reduce'});
    await expect.poll(()=>page.locator('.cos-static-eye').evaluateAll(nodes=>nodes.every(el=>el.dataset.motionPaused==='true'))).toBe(true);
    const frozen=await page.locator('.cos-static-eye canvas').evaluateAll(nodes=>nodes.map(el=>el.toDataURL()));
    await page.waitForTimeout(150);
    expect(await page.locator('.cos-static-eye canvas').evaluateAll(nodes=>nodes.map(el=>el.toDataURL()))).toEqual(frozen);
    await page.emulateMedia({media:'print'});
    expect(await page.locator('.cos-static-eye .cos-eye-live').evaluateAll(nodes=>nodes.every(el=>getComputedStyle(el).display==='none'))).toBe(true);
    expect(await page.locator('.cos-static-eye .cos-eye-poster').evaluateAll(nodes=>nodes.every(el=>getComputedStyle(el).opacity==='1'))).toBe(true);

  });
}


test('dynamic compact avatars keep their slot and removed eyes stop observing',async({page})=>{
  await mount(page,'onsite-vision');
  await page.evaluate(()=>{
    const slot=document.createElement('button');slot.id='synthetic-avatar';slot.style.cssText='width:44px;height:44px;position:fixed;top:10px;left:10px;z-index:1000';
    slot.innerHTML='<img style="width:20px;height:20px" src="./techcheck-eye-favicon-32.png" alt="Cameras Onsite">';document.body.append(slot);
  });
  const eye=page.locator('#synthetic-avatar .cos-static-eye');await expect(eye).toHaveAttribute('data-eye-ready','true');
  expect((await eye.boundingBox()).width).toBe(20);await expect(eye.locator('canvas')).toHaveCount(1);
  await page.evaluate(()=>document.getElementById('synthetic-avatar').remove());await expect(eye).toHaveCount(0);
});

test('CSS background eye slots also animate without replacing their container',async({page})=>{
  await mount(page,'index');
  await page.evaluate(()=>{
    const slot=document.createElement('div');slot.id='synthetic-background-eye';slot.className='brandTarget';
    slot.style.cssText='position:fixed;top:10px;right:10px;z-index:1000';document.body.append(slot);
  });
  const slot=page.locator('#synthetic-background-eye'),eye=slot.locator(':scope > .cos-static-eye');
  await expect(eye).toHaveAttribute('data-eye-ready','true');await expect(eye).toHaveAttribute('data-motion-paused','false');
  expect((await eye.boundingBox()).width).toBeCloseTo((await slot.boundingBox()).width,1);
  await expect(eye.locator('canvas')).toHaveCount(1);
  await page.evaluate(()=>document.getElementById('synthetic-background-eye').append(document.createElement('span')));
  await expect(slot.locator('.cos-static-eye')).toHaveCount(1);
});

test('company headers use the full lockup while login and AI keep only the eye',async({page},info)=>{
  await mount(page,'index');
  await page.evaluate(()=>{
    document.getElementById('sessionLoading')?.remove();document.body.className='';
    document.getElementById('authView')?.classList.remove('hidden');
    const brand=document.createElement('div');brand.id='company-logo-fixture';brand.className='cos-vision-brand';
    brand.style.cssText='position:fixed;bottom:20px;left:20px;z-index:1000';
    brand.innerHTML='<img src="./operations/dist/resources/vision-eye-round.svg" alt="Cameras Onsite"><div>Old company branding</div>';
    document.body.append(brand);
  });
  const full=page.locator('#company-logo-fixture .cos-company-logo');
  await expect(full).toHaveAttribute('data-eye-ready','true');
  await expect(page.locator('#authView .cos-static-eye')).toHaveAttribute('data-company-logo','eye');
  await expect(page.locator('#company-logo-fixture>div')).toBeHidden();
  const canvas=full.locator('canvas');
  const fixed=await canvas.evaluate(c=>{
    const ctx=c.getContext('2d');return Array.from(ctx.getImageData(Math.floor(c.width*.4),0,Math.floor(c.width*.6),c.height).data);
  });
  const first=await canvas.evaluate(c=>c.toDataURL());
  await expect.poll(()=>canvas.evaluate(c=>c.toDataURL()),{timeout:5000}).not.toBe(first);
  const after=await canvas.evaluate(c=>Array.from(c.getContext('2d').getImageData(Math.floor(c.width*.4),0,Math.floor(c.width*.6),c.height).data));
  expect(after).toEqual(fixed);
  for(const width of [320,390,1440]){
    await page.setViewportSize({width,height:900});await checkEyes(page);
    await page.screenshot({path:info.outputPath('company-login-split-'+width+'.png')});
  }
});

test('Operations desktop and mobile use a complete animated company logo',async({page},info)=>{
  await page.route('**/*',async route=>{
    const url=route.request().url();
    if(url===origin+'/logo-operations-fixture')return route.fulfill({contentType:'text/html',body:`<meta name="viewport" content="width=device-width,initial-scale=1"><style>body{margin:0}iframe{width:100%;height:100vh;border:0}</style><iframe src="/#today"></iframe><script>addEventListener('message',e=>{if(e.origin===location.origin&&e.data.type==='COS_OPERATIONS_TOKEN_REQUEST')e.source.postMessage({type:'COS_OPERATIONS_TOKEN_RESPONSE',requestId:e.data.requestId,role:'owner',accessToken:'synthetic-only'},location.origin)})</script>`});
    if(url.startsWith(origin+'/'))return route.continue();
    if(!url.endsWith('/functions/v1/cos-operations-pages'))return route.abort();
    const headers={'access-control-allow-origin':origin,'access-control-allow-methods':'POST, OPTIONS','access-control-allow-headers':'authorization, content-type'};
    if(route.request().method()==='OPTIONS')return route.fulfill({status:204,headers});
    const req=route.request().postDataJSON();expect(req.method).toBe('GET');
    const data=req.path==='/api/session'?{authorized:true,role:'Owner',name:'Logo fixture owner',features:{}}:{items:[],jobs:[],tasks:[],readiness:[],asOf:new Date().toISOString()};
    return route.fulfill({headers,contentType:'application/json',body:JSON.stringify(data)});
  });
  await page.goto('/logo-operations-fixture');
  const frame=page.frameLocator('iframe');
  await expect(frame.getByText('OPERATIONS CONNECTED',{exact:true})).toBeVisible();
  for(const width of [320,390,1024,1440]){
    await page.setViewportSize({width,height:900});
    const logo=frame.locator('.cos-company-logo:visible').first();
    await expect(logo).toHaveAttribute('data-eye-ready','true');
    const bounds=await logo.boundingBox();expect(bounds.width/bounds.height).toBeCloseTo(1490/530,1);
    expect(bounds.x).toBeGreaterThanOrEqual(0);expect(bounds.x+bounds.width).toBeLessThanOrEqual(width);
    const sidebar=frame.locator('.operations-sidebar:visible');
    if(await sidebar.count()){const side=await sidebar.boundingBox();expect(bounds.x+bounds.width).toBeLessThanOrEqual(side.x+side.width);}
    expect(await frame.locator('body').evaluate(()=>document.documentElement.scrollWidth)).toBeLessThanOrEqual(width+1);
    if(width===390||width===1440)await page.screenshot({path:info.outputPath('operations-logo-'+width+'.png')});
  }
});
