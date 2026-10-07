import { test, expect } from '@playwright/test';
import { readFileSync, existsSync } from 'node:fs';
import { resolve, extname } from 'node:path';
import { fileURLToPath } from 'node:url';

const origin='http://127.0.0.1:4173';
const repo=resolve(fileURLToPath(new URL('../../..',import.meta.url)));
const edge='https://tughscoxralhofrckvxy.supabase.co/functions/v1/cos-operations-pages';
const types={'.html':'text/html','.js':'text/javascript','.css':'text/css','.svg':'image/svg+xml','.png':'image/png','.jpg':'image/jpeg','.woff2':'font/woff2'};
const html=readFileSync(resolve(repo,'tech-checks/index.html'),'utf8')
  .replace(/<script\b[^>]*>[\s\S]*?<\/script>/gi,'')
  .replace('</body>',`<script>
    window.fixture={role:new URLSearchParams(location.search).get('role')||'owner',subject:'fixture-person',routes:[],views:[],signOut:0};
    document.getElementById('sessionLoading').remove();
    document.getElementById('appView').classList.remove('hidden');
    window.TechCheckContext={getRole:()=>fixture.role,getEffectiveRole:()=>fixture.role,getSession:()=>fixture.subject?{user:{id:fixture.subject}}:null,
      db:{auth:{onAuthStateChange:listener=>{fixture.auth=listener;return{}},getSession:async()=>({data:{session:fixture.subject?{user:{id:fixture.subject},access_token:'synthetic-only'}:null}})}}};
    for(const [view,label] of [['it','IT'],['svc','Service']])document.getElementById('view-'+view).innerHTML='<section class="card"><h1>'+label+' checklist</h1><label>In-progress check note<input aria-label="In-progress check note" value="Saved synthetic check"></label></section>';
    for(const [tab,view] of [['tab-it','it'],['tab-svc','svc']])document.getElementById(tab).addEventListener('click',()=>{document.querySelector('#view-'+view+' input').value='Dashboard restarted'});
    window.show=view=>{fixture.views.push(view);for(const name of ['owner','it','svc'])document.getElementById('view-'+name).classList.toggle('hidden',name!==view);dispatchEvent(new CustomEvent('techcheck:view-changed',{detail:{view}}))};
    window.ownerAppNavigate=route=>{fixture.routes.push(route);document.getElementById('view-owner').dataset.ownerRoute=route;document.getElementById('ownerRouteView').innerHTML='<section class="card"><h1>'+route+' check tool</h1><button data-owner-route="today">Old dashboard link</button></section>';const accounts=document.getElementById('ownerPersistentAccounts');accounts.style.display=route==='accounts'?'block':'none';accounts.style.visibility=route==='accounts'?'visible':'hidden';accounts.setAttribute('aria-hidden',route==='accounts'?'false':'true');};
    document.getElementById('ownerApp').addEventListener('click',event=>{const button=event.target.closest('[data-owner-route]');if(button)ownerAppNavigate(button.dataset.ownerRoute)});
    window.refreshData=()=>dispatchEvent(new CustomEvent('techcheck:data-refreshed'));
    window.logout=()=>{fixture.signOut++;fixture.subject=null;fixture.role=null;document.getElementById('appView').classList.add('hidden');fixture.auth?.('SIGNED_OUT',null)};
    show(fixture.role==='owner'?'owner':fixture.role==='service'?'svc':'it');
  </script><script type="module" src="./operations-host.js"></script></body>`);

async function mount(page,path='/tech-checks/') {
  const requests=[];
  await page.route('**/*',async route=>{
    const url=new URL(route.request().url());
    if(url.origin===origin){
      if(url.pathname==='/tech-checks/')return route.fulfill({contentType:'text/html',body:html});
      const file=resolve(repo,'.'+decodeURIComponent(url.pathname));
      if(file.startsWith(repo+'/')&&existsSync(file))return route.fulfill({path:file,contentType:types[extname(file)]||'application/octet-stream'});
      return route.abort('blockedbyclient');
    }
    if(url.href!==edge)return route.abort('blockedbyclient');
    const headers={'access-control-allow-origin':origin,'access-control-allow-methods':'POST, OPTIONS','access-control-allow-headers':'authorization, content-type'};
    if(route.request().method()==='OPTIONS')return route.fulfill({status:204,headers});
    const request=route.request().postDataJSON();requests.push(request);expect(request.method).toBe('GET');
    const data=request.path==='/api/session'?{authorized:true,role:'Owner',name:'Fixture Owner'}:{items:[]};
    return route.fulfill({headers,contentType:'application/json',body:JSON.stringify(data)});
  });
  await page.goto(path);
  return {frame:page.frameLocator('#cosOperationsFrame'),requests};
}
async function openChecks(frame){
  await frame.getByRole('button',{name:'More',exact:true}).click();
  const menu=frame.getByRole('dialog',{name:'Operations navigation'});
  await expect(menu.getByRole('button',{name:'Tech Checks',exact:true})).toHaveCount(1);
  await expect(menu.getByRole('button',{name:'Accounts & Permissions',exact:true})).toHaveCount(0);
  await menu.getByRole('button',{name:'Tech Checks',exact:true}).click();
  await expect(frame.getByRole('heading',{name:'Tech Checks',exact:true})).toBeVisible();
}

test('one Tech Checks front door contains IT, Service and preserved check tools',async({page},testInfo)=>{
  const {frame,requests}=await mount(page);await openChecks(frame);
  const hub=frame.getByRole('region',{name:'Tech Check workspaces'});
  await expect(hub.getByRole('button',{name:/^IT Preparation/})).toBeVisible();
  await expect(hub.getByRole('button',{name:/^Service Truck/})).toBeVisible();
  await expect(hub).toContainText('dispatch jobs are in Operations');
  await page.screenshot({path:testInfo.outputPath('one-tech-checks-hub.png')});
  for(const [label,route] of [['Technician accounts','accounts'],['Check assignments','assign'],['Truck & team readiness','team'],['Review completed checks','review'],['Check handoffs & returns','handoffs'],['Check schedule','calendar'],['Checks needing attention','attention'],['Checked equipment','units'],['Check history','history'],['Check activity','activity']]){
    await hub.getByRole('button',{name:new RegExp('^'+label)}).click();
    await expect(page.locator('#cosTechCheckToolTitle')).toHaveText(label);

    await expect(page.locator('#cosTechCheckToolTitle')).toBeVisible();
    await expect(page.locator('body')).toHaveCSS('background-color','rgb(11, 17, 28)');
    await expect(page.locator('#ownerAppPage')).toHaveCSS('background-color','rgb(11, 17, 28)');
    const layout=await page.locator('#cosOperationsLegacy').evaluate(el=>({header:el.querySelector('header').getBoundingClientRect().bottom,main:el.querySelector('#ownerApp>.ownerAppWorkspace').getBoundingClientRect().top}));
    expect(layout.main).toBeGreaterThanOrEqual(layout.header);
    await expect(page.locator('#cosOperationsLegacy')).toBeVisible();
    await expect(page.locator('#ownerPrimaryNav')).toBeHidden();
    await expect(page.locator('#ownerApp>.ownerAppWorkspace>.ownerItTopbar')).toBeHidden();
    await expect(page.locator('#ownerApp>.ownerAppWorkspace>.ownerWorkspaceTools')).toBeHidden();
    expect(new URL(page.url()).hash).toBe('#tech-checks/'+route);
    expect(await page.evaluate(()=>document.documentElement.scrollWidth)).toBeLessThanOrEqual(page.viewportSize().width);
    if(route==='accounts'){
      await page.locator('#cosOperationsLegacy').screenshot({path:testInfo.outputPath('accounts-inside-tech-checks.png')});
      await expect(page.locator('#ownerPersistentAccounts')).toBeVisible();
    }
    await page.locator('#cosOperationsReturn').click();
    await expect(hub).toBeVisible();
  }
  expect((await page.evaluate(()=>fixture)).subject).toBe('fixture-person');
  expect(requests.every(request=>request.method==='GET')).toBe(true);
});

test('IT and Service checks return to the same hub and preserve in-progress inputs through repeat and history navigation',async({page})=>{
  const {frame}=await mount(page);await openChecks(frame);
  const hub=frame.getByRole('region',{name:'Tech Check workspaces'});
  for(const [label,view,route] of [['IT','it','it'],['Service','svc','service']]){
    await hub.getByRole('button',{name:new RegExp('^'+label+' ')}).click();
    const note=page.locator('#view-'+view).getByRole('textbox',{name:'In-progress check note'});
    await expect(note).toBeVisible();await note.fill('Unsubmitted '+label+' note');
    await page.evaluate(route=>{const frame=document.getElementById('cosOperationsFrame');dispatchEvent(new MessageEvent('message',{origin:location.origin,source:frame.contentWindow,data:{type:'COS_OPERATIONS_NAVIGATE',route}}))},route);
    await expect(note).toHaveValue('Unsubmitted '+label+' note');
    await page.locator('#cosOperationsTechReturn').click();await expect(hub).toBeVisible();
    await page.goBack();await expect(note).toBeVisible();await expect(note).toHaveValue('Unsubmitted '+label+' note');
    await page.goForward();await expect(hub).toBeVisible();
  }
  expect((await page.evaluate(()=>fixture)).role).toBe('owner');
});

test('old dashboard links and browser Back return to Tech Checks rather than a second dashboard',async({page})=>{
  const {frame}=await mount(page);await openChecks(frame);
  const hub=frame.getByRole('region',{name:'Tech Check workspaces'});
  await hub.getByRole('button',{name:/^Technician accounts/}).click();
  await page.getByRole('button',{name:'Old dashboard link'}).click();
  await expect(hub).toBeVisible();await expect(page.locator('#cosOperationsLegacy')).toBeHidden();
  await page.goBack();await expect(page.locator('#cosTechCheckToolTitle')).toHaveText('Technician accounts');
  await page.goBack();await expect(hub).toBeVisible();
});

test('bookmarked tools load in their scoped view and stay owner-only across auth changes',async({page})=>{
  const {frame}=await mount(page,'/tech-checks/#tech-checks/accounts');
  await expect(page.locator('#cosTechCheckToolTitle')).toHaveText('Technician accounts');
  await page.locator('#cosOperationsReturn').click();await expect(frame.getByRole('heading',{name:'Tech Checks',exact:true})).toBeVisible();
  await page.evaluate(()=>logout());await expect(page.locator('#cosOperationsFrame')).toHaveCount(0);
  for(const role of ['it','service']){
    await page.goto('/tech-checks/?role='+role+'#tech-checks/accounts');
    await expect(page.locator('#cosOperationsFrame')).toHaveCount(0);
    await expect(page.locator('#cosOperationsLegacy')).toBeHidden();
    await expect(page.locator('#cosOperationsTechReturn')).toBeHidden();
    await expect(page.getByRole('heading',{name:(role==='it'?'IT':'Service')+' checklist'})).toBeVisible();
  }
});


test('leaving Tech Checks clears the scoped bookmark without hijacking another workspace',async({page})=>{
  const {frame}=await mount(page,'/tech-checks/#tech-checks');
  await expect(frame.getByRole('heading',{name:'Tech Checks',exact:true})).toBeVisible();
  await frame.getByRole('button',{name:'More',exact:true}).click();
  await frame.getByRole('dialog',{name:'Operations navigation'}).getByRole('button',{name:'Dashboard',exact:true}).click();
  await expect.poll(()=>new URL(page.url()).hash).toBe('');
  await page.reload();
  await expect(frame.getByRole('heading',{name:'VISION Operations',exact:true})).toBeVisible();
});
