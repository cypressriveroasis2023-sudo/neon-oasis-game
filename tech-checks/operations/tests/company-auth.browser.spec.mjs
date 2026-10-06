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
for(const width of [320,390,701,1024,1440])test('real host authentication surfaces stay light and contained at '+width,async({page},testInfo)=>{
  await page.setViewportSize({width,height:1000});
  await page.emulateMedia({colorScheme:'dark'});
  await mountHost(page);
  for(const state of ['signin','reset','forced']){
    await showState(page,state);
    const view=page.locator(state==='forced'?'#forcePasswordView':'#authView');
    await expect(view).toBeVisible();
    await expect(page.locator('#sessionLoading')).toHaveCount(0);
    const hero=view.locator('.hero');
    expect(await hero.evaluate(el=>getComputedStyle(el).backgroundColor)).toBe('rgb(255, 255, 255)');
    await readable(view.locator('.cos-vision-brand strong'),'rgb(255, 255, 255)');
    await readable(view.locator('.cos-vision-brand small'),'rgb(255, 255, 255)');
    for(const card of await view.locator('.card:visible').all()){
      expect(await card.evaluate(el=>getComputedStyle(el).backgroundColor)).toBe('rgb(255, 255, 255)');
      for(const heading of await card.locator('h2,h3').all())await readable(heading,'rgb(255, 255, 255)');
    }
    for(const input of await view.locator('input:visible').all()){
      const style=await readable(input);expect(style.background).toBe('rgb(255, 255, 255)');
      await input.focus();expect(await input.evaluate(el=>getComputedStyle(el).outlineColor)).toBe('rgb(49, 95, 223)');
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
