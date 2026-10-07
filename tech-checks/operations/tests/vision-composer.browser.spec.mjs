import { test, expect } from '@playwright/test';
import { readFileSync, existsSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { resolve, extname } from 'node:path';

const repo = resolve(fileURLToPath(new URL('../../..', import.meta.url)));
const origin = 'http://127.0.0.1:4173';
// Real Vision markup, styles, and event handlers; all transport is synthetic.
// No sign-in, AI billing, microphone access, customer data, or live mutations.
async function mount(page, {modelConfigured=true, role='owner', signedIn=true}={}) {
  await page.addInitScript(({modelConfigured,role,signedIn}) => {
    const chats=Array.from({length:20},(_,i)=>({id:`test-${i}`, title:i?'Previous question '+i:'New conversation',messages:[],updatedAt:'2026-10-06T12:00:00Z'}));
    chats[1].messages=[{role:'assistant',html:'<div class="vision-answer-title">Synthetic long answer</div>'+Array(50).fill('<p>Locally generated test content. No live business information.</p>').join('')}];
    chats[2].messages=[{role:'assistant',html:'<div class="vision-draft-card"><b>Synthetic review</b>'+Array(50).fill('<p>Review line for scrolling.</p>').join('')+'</div>'}];
    localStorage.setItem('cos-onsite-vision-chats-v1',JSON.stringify(chats));
    window.__visionRequests=[];
    window.__visionFail=false;
    window.supabase={createClient:()=>({
      auth:{getSession:async()=>({data:{session:signedIn?{user:{id:'synthetic-owner'}}:null}})},
      from:()=>{const q=new Proxy({}, {get:(_,key)=>key==='then'?resolve=>Promise.resolve({data:[]}).then(resolve):key==='single'?async()=>({data:{role,full_name:'Synthetic Owner',active:true}}):()=>q});return q;},
      functions:{invoke:async(name,{body})=>{
        if(body.mode==='status')return {data:{ok:true,model_configured:modelConfigured}};
        window.__visionRequests.push(body);
        await new Promise(resolve=>setTimeout(resolve,window.__visionDelay||100));
        return window.__visionFail?{data:{ok:false,code:'OPENAI_API_KEY_MISSING'}}:{data:{ok:true,answer:'Synthetic test response',proposed_action:{type:'none'}}};
      }}
    })};
  },{modelConfigured,role,signedIn});
  await page.route('**/*',route=>{
    const url=new URL(route.request().url());
    if(url.origin!==origin)return route.abort('blockedbyclient');
    if(url.pathname==='/tech-checks/')return route.fulfill({body:'<!doctype html><title>Sign in</title><p>Sign-in destination</p>',contentType:'text/html'});
    const file=resolve(repo,'.'+decodeURIComponent(url.pathname));
    if(!file.startsWith(repo+'/')||!existsSync(file))return route.abort('blockedbyclient');
    if(url.pathname.endsWith('onsite-vision.html')){
      const body=readFileSync(file,'utf8').replace(/<script\b[^>]*>[\s\S]*?<\/script>/gi,match=>/src="\.\/(?:onsite-vision\.js|tech-check-rules\.js|cos-eye-branding\.js)/.test(match)?match:'');
      return route.fulfill({body,contentType:'text/html'});
    }
    return route.fulfill({path:file,contentType:({'.css':'text/css','.js':'text/javascript','.woff':'font/woff','.jpg':'image/jpeg','.png':'image/png','.svg':'image/svg+xml'})[extname(file)]||'application/octet-stream'});
  });
  await page.goto('/tech-checks/onsite-vision.html');
  if(signedIn&&role==='owner')await expect(page.locator('#visionApp')).toBeVisible();
}
async function visibleComposer(page) {
  const prompt=page.getByRole('textbox',{name:'Ask Vision',exact:true});
  await expect(prompt).toBeVisible();
  await expect(page.getByRole('button',{name:'Send',exact:true})).toBeVisible();
  // The visualViewport resize handler schedules layout; assert the same bounds after it settles.
  await expect.poll(()=>page.evaluate(()=>['#visionPrompt','#visionSendButton','.vision-composer-wrap'].every(selector=>{const r=document.querySelector(selector).getBoundingClientRect();return r.top>=0&&r.bottom<=(window.visualViewport?.height||innerHeight)+1&&r.left>=0&&r.right<=innerWidth+1;}))).toBe(true);
  const bounds=await page.evaluate(()=>{
    const viewport=window.visualViewport;
    return ['#visionPrompt','#visionSendButton','.vision-composer-wrap'].map(selector=>{
      const el=document.querySelector(selector),r=el.getBoundingClientRect();
      const center=document.elementFromPoint(r.x+r.width/2,r.y+r.height/2);
      return {selector,top:r.top,bottom:r.bottom,left:r.left,right:r.right,height:viewport?.height||innerHeight,width:innerWidth,hit:selector==='.vision-composer-wrap'||el===center||el.contains(center)};
    });
  });
  for(const b of bounds){expect(b.top,JSON.stringify(b)).toBeGreaterThanOrEqual(0);expect(b.bottom,JSON.stringify(b)).toBeLessThanOrEqual(b.height+1);expect(b.left).toBeGreaterThanOrEqual(0);expect(b.right).toBeLessThanOrEqual(b.width+1);}
  await expect.poll(()=>prompt.evaluate(el=>{const r=el.getBoundingClientRect();return document.elementFromPoint(r.x+r.width/2,r.y+r.height/2)===el;})).toBe(true);
}

test('Vision composer stays visible with a full Recent list and narrowed keyboard viewport',async({page},testInfo)=>{
  await mount(page);
  for(const size of [{width:1440,height:800},{width:1024,height:768},{width:768,height:600},{width:390,height:844},{width:320,height:568},{width:390,height:360}]){
    await page.setViewportSize(size);await visibleComposer(page);
    await page.getByRole('textbox',{name:'Ask Vision',exact:true}).fill('A question I can see');
    await page.screenshot({path:testInfo.outputPath(`vision-composer-${size.width}x${size.height}.png`)});
  }
});

test('Vision typed questions use the existing transport, support multiline and IME, and reset cleanly',async({page})=>{
  await mount(page);const prompt=page.getByRole('textbox',{name:'Ask Vision',exact:true});
  await prompt.fill('');await page.getByRole('button',{name:'Send',exact:true}).click();
  expect(await page.evaluate(()=>window.__visionRequests.length)).toBe(0);
  await prompt.fill('A synthetic question');await prompt.press('Shift+Enter');await prompt.type('Second line');
  await expect(prompt).toHaveValue('A synthetic question\nSecond line');
  await prompt.dispatchEvent('keydown',{key:'Enter',code:'Enter',isComposing:true});
  expect(await page.evaluate(()=>window.__visionRequests.length)).toBe(0);
  await prompt.press('Enter');
  await expect(page.locator('.vision-agent-answer')).toHaveText('Synthetic test response');
  expect(await page.evaluate(()=>window.__visionRequests[0].message)).toBe('A synthetic question\nSecond line');
  await expect(prompt).toHaveValue('');await visibleComposer(page);
  await page.getByRole('button',{name:'New conversation',exact:true}).click();await visibleComposer(page);
  await page.getByRole('button',{name:'New conversation',exact:true}).click();await visibleComposer(page);
  await prompt.fill('Another synthetic question');await page.getByRole('button',{name:'Send',exact:true}).click();
  await expect(page.locator('.vision-agent-answer')).toHaveText('Synthetic test response');
  expect(await page.evaluate(()=>window.__visionRequests.length)).toBe(2);
});

test('Vision history, summary, voice mode and drawers retain a reachable composer and scrolling',async({page})=>{
  await mount(page);
  for(const id of ['test-1','test-2']){
    if(await page.locator('#visionMenuButton').isVisible())await page.locator('#visionMenuButton').click();
    await page.locator(`[data-chat-id="${id}"]`).click();await visibleComposer(page);
    const result=await page.locator(id==='test-2'?'.vision-draft-card':'.vision-results').evaluate(el=>{el.scrollTop=el.scrollHeight;return {top:el.scrollTop,height:el.clientHeight,scroll:el.scrollHeight};});
    expect(result.scroll).toBeGreaterThan(result.height);expect(result.top).toBeGreaterThan(0);
  }
  await page.evaluate(()=>document.body.classList.add('vision-voice-session'));await visibleComposer(page);
  await page.setViewportSize({width:390,height:700});
  await page.locator('#visionMenuButton').click();await expect(page.locator('#visionApp')).toHaveClass(/sidebar-open/);
  await page.locator('#visionShade').click({position:{x:385,y:400}});await expect(page.locator('#visionApp')).not.toHaveClass(/sidebar-open/);await visibleComposer(page);
});

test('Vision clearly reports an unconfigured AI while keeping questions available',async({page})=>{
  await mount(page,{modelConfigured:false});
  await expect(page.locator('#visionAgentNotice')).toContainText('AI is not configured');await visibleComposer(page);
});

test('Vision reports a provider failure without losing the composer',async({page})=>{
  await mount(page);await page.evaluate(()=>{window.__visionFail=true;});
  await page.getByRole('textbox',{name:'Ask Vision',exact:true}).fill('A synthetic question');await page.getByRole('button',{name:'Send',exact:true}).click();
  await expect(page.locator('#visionAgentNotice')).toContainText('AI is not configured');await visibleComposer(page);
});

for(const auth of [{signedIn:false},{role:'service'}])test(`Vision retains existing owner access check ${JSON.stringify(auth)}`,async({page})=>{
  await mount(page,auth);await expect(page).toHaveURL(/\/tech-checks\/$/);await expect(page.getByText('Sign-in destination')).toBeVisible();
});

 test('Vision prevents overlapping sends while preserving the next typed question',async({page})=>{
  await mount(page);await page.evaluate(()=>{window.__visionDelay=800;});
  const prompt=page.getByRole('textbox',{name:'Ask Vision',exact:true}),send=page.getByRole('button',{name:'Send',exact:true});
  await prompt.fill('First synthetic question');await send.click();await expect(send).toBeDisabled();
  await prompt.fill('Next synthetic question');await prompt.press('Enter');
  await expect(prompt).toHaveValue('Next synthetic question');
  expect(await page.evaluate(()=>window.__visionRequests.length)).toBe(1);
  await expect(send).toBeEnabled();await send.click();await expect(send).toBeEnabled();
  expect(await page.evaluate(()=>window.__visionRequests.length)).toBe(2);
});
