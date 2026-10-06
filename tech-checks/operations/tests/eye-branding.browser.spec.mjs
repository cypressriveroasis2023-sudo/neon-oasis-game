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
  const eyes = page.locator('.cos-static-eye:visible');
  expect(await eyes.count()).toBeGreaterThan(0);
  const values = await eyes.evaluateAll(async nodes => {
    await Promise.all(nodes.flatMap(el => [...el.querySelectorAll('image')].map(layer => { const image = new Image(); image.src = layer.getAttribute('href'); return image.decode(); })));
    return nodes.map(el => { const r=el.getBoundingClientRect(); const g=el.querySelector('.cos-eye-gaze'); return { width:r.width,height:r.height,housing:getComputedStyle(el.querySelector('.cos-eye-housing')).transform,duration:getComputedStyle(g).animationDuration,layers:el.querySelectorAll('image').length,left:r.left,right:r.right,viewport:innerWidth }; });
  });
  for (const v of values.filter(v=>v.right>0 && v.left<v.viewport)) {
    expect(v.width).toBeGreaterThanOrEqual(31); expect(v.height).toBeCloseTo(v.width,1);
    expect(v.housing).toBe('none'); expect(v.duration).toBe('12s'); expect(v.layers).toBe(2);
    expect(v.left).toBeGreaterThanOrEqual(-1); expect(v.right).toBeLessThanOrEqual(v.viewport+1);
  }
  const ids=await page.locator('.cos-static-eye clipPath').evaluateAll(nodes=>nodes.map(el=>el.id));
  expect(new Set(ids).size).toBe(ids.length);
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
    for(const v of await page.locator('.cos-static-eye .cos-eye-gaze').evaluateAll(nodes=>nodes.map(el=>({animation:getComputedStyle(el).animationName,transform:getComputedStyle(el).transform})))){expect(v.animation).toBe('none');expect(['none','matrix(1, 0, 0, 1, 0, 0)']).toContain(v.transform);}
  });
}
