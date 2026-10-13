import { test, expect } from '@playwright/test';
import { readFileSync, existsSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { resolve, extname } from 'node:path';

const repo = resolve(fileURLToPath(new URL('../../..', import.meta.url)));
const origin = 'http://127.0.0.1:4173';
// Real Vision markup, styles, and event handlers; all transport is synthetic.
// No sign-in, AI billing, microphone access, customer data, or live mutations.
async function mount(page, {modelConfigured=true, role='owner', signedIn=true,readFailures=[],readRejections=[]}={}) {
  await page.addInitScript(({modelConfigured,role,signedIn,readFailures,readRejections}) => {
    const chats=Array.from({length:20},(_,i)=>({id:`test-${i}`, title:i?'Previous question '+i:'New conversation',messages:[],updatedAt:'2026-10-06T12:00:00Z'}));
    chats[1].messages=[{role:'assistant',html:'<div class="vision-answer-title">Synthetic long answer</div>'+Array(50).fill('<p>Locally generated test content. No live business information.</p>').join('')}];
    chats[2].messages=[{role:'user',text:'Keep this earlier request visible'},{role:'assistant',html:'<p>Earlier answer before the draft.</p>'},{role:'assistant',html:'<div class="vision-draft-card"><b>Synthetic review</b>'+Array(50).fill('<p>Review line for scrolling.</p>').join('')+'</div>'}];
    localStorage.setItem('cos-onsite-vision-chats-v1',JSON.stringify(chats));
    window.__visionRequests=[];
    window.__visionFail=false;
    window.__readFailures=readFailures;window.__readRejections=readRejections;
    window.__visionActions=[];
    window.OnSiteVisionActions={
      configure(){},
      prepare:async params=>{window.__visionActions.push({kind:'prepare',params});return{executable:true,action_id:'synthetic-action-'+window.__visionActions.length,canonical_action:params.action};},
      execute:async actionId=>{window.__visionActions.push({kind:'execute',actionId});return{status:'succeeded',ticket_no:'999'};},
      cancel:async actionId=>{window.__visionActions.push({kind:'cancel',actionId});}
    };
    window.supabase={createClient:()=>({
      auth:{getSession:async()=>({data:{session:signedIn?{user:{id:'synthetic-owner'}}:null}})},
      from:table=>{const q=new Proxy({}, {get:(_,key)=>key==='then'?(resolve,reject)=>window.__readRejections.includes(table)?Promise.reject(new Error('Synthetic read rejected')).then(resolve,reject):Promise.resolve({data:[],error:window.__readFailures.includes(table)?{message:'Synthetic read unavailable'}:null}).then(resolve,reject):key==='single'?async()=>({data:{role,full_name:'Synthetic Owner',active:true}}):()=>q});return q;},
      functions:{invoke:async(name,{body})=>{
        if(body.mode==='status')return {data:{ok:true,model_configured:modelConfigured}};
        window.__visionRequests.push(body);
        if(window.__visionHold)await new Promise(resolve=>{window.__visionRelease=resolve;});
        else await new Promise(resolve=>setTimeout(resolve,window.__visionDelay||100));
        return window.__visionFail?{data:{ok:false,code:'OPENAI_API_KEY_MISSING'}}:{data:window.__visionReply||{ok:true,answer:'Synthetic test response',proposed_action:{type:'none'}}};
      }}
    })};
  },{modelConfigured,role,signedIn,readFailures,readRejections});
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
  await mount(page);await page.evaluate(()=>{window.__visionHold=true;});
  const prompt=page.getByRole('textbox',{name:'Ask Vision',exact:true}),send=page.getByRole('button',{name:'Send',exact:true});
  await prompt.fill('First synthetic question');await send.click();await expect(send).toBeDisabled();
  await prompt.fill('Next synthetic question');await prompt.press('Enter');
  await expect(prompt).toHaveValue('Next synthetic question');
  expect(await page.evaluate(()=>window.__visionRequests.length)).toBe(1);
  await page.evaluate(()=>{window.__visionHold=false;window.__visionRelease();});
  await expect(send).toBeEnabled();await send.click();await expect(send).toBeEnabled();
  expect(await page.evaluate(()=>window.__visionRequests.length)).toBe(2);
});

test('Vision keeps a delayed answer and ticket memory in its original conversation',async({page})=>{
  await mount(page);
  await page.evaluate(()=>{window.__visionHold=true;window.__visionReply={ok:true,answer:'Reply for the original chat',active_ticket:'999',working_memory_update:{active_ticket:'999'},proposed_action:{type:'none'}};});
  await page.getByRole('textbox',{name:'Ask Vision',exact:true}).fill('Original question');
  await page.getByRole('button',{name:'Send',exact:true}).click();
  await expect(page.locator('[data-chat-id="test-1"]')).toBeDisabled();
  await expect(page.locator('#visionAddButton')).toBeDisabled();
  // Programmatic attempts also cannot switch the active conversation mid-request.
  await page.evaluate(()=>{document.querySelector('[data-chat-id="test-1"]').dispatchEvent(new MouseEvent('click',{bubbles:true}));document.querySelector('#visionAddButton').dispatchEvent(new MouseEvent('click',{bubbles:true}));});
  await expect.poll(()=>page.evaluate(()=>Boolean(window.__visionRelease))).toBe(true);
  await page.evaluate(()=>{window.__visionHold=false;window.__visionRelease();});
  await expect(page.locator('.vision-agent-answer')).toHaveText('Reply for the original chat');
  const chats=await page.evaluate(()=>JSON.parse(localStorage.getItem('cos-onsite-vision-chats-v1')));
  expect(chats.find(c=>c.id==='test-0').ticket).toBe('999');
  expect(chats.find(c=>c.id==='test-0').messages.map(m=>m.text||m.html).join(' ')).toContain('Original question');
  expect(chats.find(c=>c.id==='test-1').ticket||'').toBe('');
  expect(chats.find(c=>c.id==='test-1').messages.map(m=>m.text||m.html).join(' ')).not.toContain('Reply for the original chat');
  await expect(page.locator('[data-chat-id="test-1"]')).toBeEnabled();
});

test('Vision retains earlier messages alongside a draft summary',async({page})=>{
  await mount(page);
  await page.locator('[data-chat-id="test-2"]').dispatchEvent('click');
  await expect(page.locator('#visionThread .vision-turn')).toHaveCount(3);
  await expect(page.locator('#visionThread')).toContainText('Keep this earlier request visible');
  await expect(page.locator('#visionThread')).toContainText('Earlier answer before the draft.');
  await expect(page.locator('.vision-draft-card')).toContainText('Synthetic review');
  await visibleComposer(page);
});

test('Vision voice replies retain the full earlier conversation without microphone access',async({page})=>{
  await mount(page);await page.locator('[data-chat-id="test-2"]').dispatchEvent('click');
  await page.evaluate(()=>{
    window.MediaRecorder=undefined;
    window.SpeechRecognition=class{
      start(){if(window.__voiceStarted)return;window.__voiceStarted=true;queueMicrotask(()=>{this.onresult?.({resultIndex:0,results:[Object.assign([{transcript:'A synthetic voice question'}],{isFinal:true})]});this.onend?.();});}
      stop(){}abort(){}
    };
  });
  await page.locator('#visionVoiceButton').click();
  await expect(page.locator('.vision-agent-answer')).toHaveText('Synthetic test response');
  await expect(page.locator('#visionThread .vision-turn')).toHaveCount(5);
  await expect(page.locator('#visionThread')).toContainText('Earlier answer before the draft.');
  await expect(page.locator('.vision-results')).toBeVisible();await visibleComposer(page);
});

test('Vision preserves the reading position when a delayed answer arrives',async({page})=>{
  await mount(page);await page.locator('[data-chat-id="test-1"]').dispatchEvent('click');
  await page.evaluate(()=>{window.__visionHold=true;});
  await page.getByRole('textbox',{name:'Ask Vision',exact:true}).fill('Answer while I read');
  await page.getByRole('button',{name:'Send',exact:true}).click();
  // Wait for the intentional scroll after Send, then read an older part of the thread.
  await expect(page.locator('#visionTyping')).toBeVisible();
  await page.evaluate(()=>new Promise(resolve=>requestAnimationFrame(()=>requestAnimationFrame(()=>requestAnimationFrame(resolve)))));
  const top=await page.locator('.vision-results').evaluate(el=>{el.scrollTop=120;return el.scrollTop;});
  await page.evaluate(()=>{window.__visionHold=false;window.__visionRelease();});
  await expect(page.locator('.vision-agent-answer')).toHaveText('Synthetic test response');
  await expect.poll(()=>page.locator('.vision-results').evaluate(el=>el.scrollTop)).toBeCloseTo(top,0);
});

for(const table of ['job_assignments','prep_tickets','profiles'])test(`Vision labels a partial read for ${table} independently of AI status`,async({page})=>{
  await mount(page,{readFailures:[table]});
  await expect(page.locator('#visionDataNotice')).toHaveClass(/vision-data-partial/);
  await expect(page.locator('#visionDataNotice')).toContainText('unavailable');
  await expect(page.locator('#visionLiveStatus')).toHaveText('AI READY');
  await visibleComposer(page);
});

test('Vision does not turn a rejected job read into a zero-count answer',async({page})=>{
  await mount(page,{modelConfigured:false,readRejections:['job_assignments']});
  await expect(page.locator('#visionAgentNotice')).toContainText('AI is not configured');
  await page.getByRole('textbox',{name:'Ask Vision',exact:true}).fill('Show me my active jobs');
  await page.getByRole('button',{name:'Send',exact:true}).click();
  await expect(page.locator('#visionThread')).toContainText('Current job data is unavailable');
  await expect(page.locator('#visionThread')).not.toContainText('No active Tech Check jobs');
  expect(await page.evaluate(()=>window.__visionActions)).toHaveLength(0);
});

test('Vision refresh recovers partial reads and reports check time separately from AI',async({page})=>{
  await mount(page);await expect(page.locator('#visionDataNotice')).toContainText('CT');
  await page.evaluate(()=>{window.__readFailures=['prep_tickets'];});
  await page.locator('#visionRefreshButton').dispatchEvent('click');
  await expect(page.locator('#visionDataNotice')).toContainText('Service orders unavailable · last successful check');
  await page.evaluate(()=>{window.__readFailures=[];});
  await page.locator('#visionRefreshButton').dispatchEvent('click');
  await expect(page.locator('#visionDataNotice')).not.toHaveClass(/vision-data-partial/);
  await expect(page.locator('#visionDataNotice')).toContainText('Tech Check checked');
  await expect(page.locator('#visionLiveStatus')).toHaveText('AI READY');
});

test('Vision copies the answer and facts without executing a proposed action',async({page})=>{
  await mount(page);
  await page.evaluate(()=>{
    Object.defineProperty(navigator,'clipboard',{configurable:true,value:{writeText:async text=>{window.__copied=text;}}});
    window.__visionReply={ok:true,answer:'Synthetic scheduled visit',facts:[{certainty:'verified',statement:'Existing appointment is Friday'}],proposed_action:{type:'schedule',ticket_no:'999',date:'2026-10-16',time:'10:00',summary:'Move appointment'}};
  });
  await page.getByRole('textbox',{name:'Ask Vision',exact:true}).fill('A synthetic question');await page.getByRole('button',{name:'Send',exact:true}).click();
  await expect(page.locator('[data-confirm-action]')).toBeEnabled();
  await page.getByRole('button',{name:'Copy answer',exact:true}).click();
  await expect(page.locator('#visionRequestStatus')).toHaveText('Answer copied.');
  const copied=await page.evaluate(()=>window.__copied);expect(copied).toContain('Synthetic scheduled visit');expect(copied).toContain('Existing appointment is Friday');
  expect(await page.evaluate(()=>window.__visionActions.filter(x=>x.kind==='execute'))).toHaveLength(0);
  await expect(page.locator('[data-confirm-action]')).toBeEnabled();
});

for(const confirm of [true,false])test(`Vision preserves explicit ${confirm?'confirmation':'cancellation'} of an audited proposal`,async({page})=>{
  await mount(page);await page.evaluate(()=>{window.__visionReply={ok:true,answer:'Review the schedule change',proposed_action:{type:'schedule',ticket_no:'999',date:'2026-10-16',time:'10:00',summary:'Move appointment'}};});
  await page.getByRole('textbox',{name:'Ask Vision',exact:true}).fill('A synthetic question');await page.getByRole('button',{name:'Send',exact:true}).click();
  await expect(page.locator('[data-confirm-action]')).toHaveText('Confirm schedule change');
  expect(await page.evaluate(()=>window.__visionActions.map(x=>x.kind))).toEqual(['prepare']);
  await page.locator(confirm?'[data-confirm-action]':'[data-cancel-action]').click();
  await expect(page.locator('#visionThread')).toContainText(confirm?'Schedule updated in Tech Check.':'No changes were made.');
  expect(await page.evaluate(()=>window.__visionActions.map(x=>x.kind))).toEqual(['prepare',confirm?'execute':'cancel']);
});

test('Vision restores a failed question only on explicit edit and preserves the next draft',async({page})=>{
  await mount(page);await page.evaluate(()=>{window.__visionFail=true;window.__visionDelay=700;});
  const prompt=page.getByRole('textbox',{name:'Ask Vision',exact:true});await prompt.fill('Question that failed');await page.getByRole('button',{name:'Send',exact:true}).click();
  await prompt.fill('Next unsent question');
  await expect(page.getByRole('button',{name:'Edit question',exact:true})).toBeVisible();await expect(prompt).toHaveValue('Next unsent question');
  await page.getByRole('button',{name:'Edit question',exact:true}).click();await expect(prompt).toHaveValue('Question that failed');
  expect(await page.evaluate(()=>window.__visionRequests.length)).toBe(1);expect(await page.evaluate(()=>window.__visionActions)).toHaveLength(0);
});

test('Vision keeps zoom available and announces request status without moving focus',async({page})=>{
  await mount(page);const viewport=await page.locator('meta[name="viewport"]').getAttribute('content');expect(viewport).not.toContain('user-scalable=no');expect(viewport).not.toContain('maximum-scale=1');
  await page.evaluate(()=>{window.__visionDelay=600;});
  const prompt=page.getByRole('textbox',{name:'Ask Vision',exact:true});await prompt.fill('Keyboard request');await prompt.press('Enter');
  await expect(page.locator('#visionRequestStatus')).toHaveAttribute('role','status');await expect(page.locator('#visionRequestStatus')).toHaveText('Thinking through your question…');
  await expect(page.locator('#visionRequestStatus')).toHaveText('Answer ready.');await expect(prompt).toBeFocused();
});
