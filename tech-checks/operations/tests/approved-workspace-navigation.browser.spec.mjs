import {test,expect} from '@playwright/test';
import {mountFleet} from './fleet-dashboard-fixtures.mjs';
import {openWorkspace} from './navigation-helper.mjs';

// Complete compiled App with the existing synthetic saved-read fixture.
// Foreign requests are intercepted/blocked by mountFleet; no real account is used.
const safe=state=>{expect(state.errors).toEqual([]);expect(state.calls.every(call=>call.method==='GET')).toBe(true);};
const route=app=>app.locator('body').evaluate(()=>location.hash);
const menu=app=>app.getByRole('dialog',{name:'Operations navigation',exact:true});

test('all four approved Owner destinations remain reachable by visible navigation',async({page})=>{
 const {app,state}=await mountFleet(page);
 const mobile=page.viewportSize().width<=700;
 const nav=app.getByRole('navigation',{name:mobile?'Mobile Operations navigation':'COS Operations',exact:true});
 await expect(nav.getByRole('button')).toHaveText(['Fleet','Tech Check','Team','More']);
 for(const [workspace,hash] of [['Tech Check','#tech-check'],['Team','#team'],['Operations','#operations'],['Field Map','#fleet-dashboard']]){
  const before=await route(app);await openWorkspace(app,workspace);
  if(mobile&&workspace==='Operations'){
   await expect(menu(app)).toBeVisible();await expect(menu(app).getByRole('region',{name:'Operations workspaces',exact:true})).toBeVisible();
   await expect(menu(app).locator('.operations-area-nav')).toBeHidden();await expect.poll(()=>route(app)).toBe(before);
  }else{await expect.poll(()=>route(app)).toBe(hash);await expect(menu(app)).toHaveCount(0);}
 }
 await expect(app.getByRole('region',{name:'COS Fleet Dashboard',exact:true})).toBeVisible();safe(state);
});

test('existing power and router tools open through More and keep their real saved-read routes',async({page})=>{
 const {app,state}=await mountFleet(page);
 await openWorkspace(app,'Victron VRM');await expect.poll(()=>route(app)).toBe('#victron-vrm');
 await expect(app.getByRole('heading',{name:'Helios power monitoring',exact:true})).toBeVisible();
 await openWorkspace(app,'InHand Routers');await expect.poll(()=>route(app)).toBe('#inhand-routers');
 await expect(app.getByRole('heading',{name:'Router inventory & reachability',exact:true})).toBeVisible();
 await openWorkspace(app,'Camera Health');await expect.poll(()=>route(app)).toBe('#camera-health');
 await expect(app.getByRole('region',{name:'COS Fleet Dashboard',exact:true})).toBeVisible();safe(state);
});

test('an already open phone menu and stale search do not hide the next destination',async({page})=>{
 const {app,state}=await mountFleet(page);const mobile=page.viewportSize().width<=700;
 await openWorkspace(app,'Operations');
 if(mobile)await expect(menu(app)).toBeVisible();
 const container=mobile?menu(app):app.locator('main');
 await container.getByRole('searchbox',{name:'Find a tool',exact:true}).fill('no-such-tool');
 await expect(container.getByRole('region',{name:'Operations workspaces',exact:true}).getByRole('status')).toContainText('No tools match');
 await openWorkspace(app,'Victron VRM');await expect.poll(()=>route(app)).toBe('#victron-vrm');
 await expect(menu(app)).toHaveCount(0);await expect(app.locator('main')).not.toHaveAttribute('inert','');safe(state);
});

test('restricted IT keeps its two original destinations and never exposes Owner More tools',async({page})=>{
 const {app,state}=await mountFleet(page,true);
 await openWorkspace(app,'Camera Health');await expect.poll(()=>route(app)).toBe('#camera-health');
 await openWorkspace(app,'Field Map');await expect.poll(()=>route(app)).toBe('#fleet-dashboard');
 await expect(app.locator('.cos-approved-shell')).toHaveCount(0);
 await expect(app.getByRole('region',{name:'Operations workspaces',exact:true})).toHaveCount(0);
 await expect(app.getByRole('searchbox',{name:'Find a tool',exact:true})).toHaveCount(0);
 const mobile=page.viewportSize().width<=700;
 if(mobile)await app.getByRole('navigation',{name:'Mobile Operations navigation',exact:true}).getByRole('button',{name:'More',exact:true}).click();
 await expect(app.getByRole('navigation',{name:'COS Operations',exact:true}).getByRole('button')).toHaveText(['Fleet Dashboard','Camera Health']);
 if(mobile)await menu(app).getByRole('button',{name:/Close menu/}).click();safe(state);
});


test('requesting the already open power page preserves selection and adds no saved read',async({page})=>{
 const {app,state}=await mountFleet(page);
 await openWorkspace(app,'Victron VRM');
 await expect(app.getByRole('navigation',{name:'Helios installations',exact:true}).getByRole('button')).toHaveCount(2);
 await app.getByRole('button',{name:'Next Helios unit',exact:true}).click();
 const selected=app.getByRole('definition').filter({hasText:/^\d+$/});await expect(selected).toHaveText('1011');
 const reads=state.calls.length;await openWorkspace(app,'Victron VRM');
 await expect(selected).toHaveText('1011');expect(state.calls.length).toBe(reads);safe(state);
});
