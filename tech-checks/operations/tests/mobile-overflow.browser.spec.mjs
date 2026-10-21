import {test,expect} from '@playwright/test';
import {readFileSync} from 'node:fs';
import {mountFleet} from './fleet-dashboard-fixtures.mjs';
import {fieldProductFixture} from './fixtures/mhelp-field-health-fixtures.mjs';

for(const it of [false,true])for(const width of [320,390,430])test(`${it?'IT':'Owner'} Fleet remains anchored at ${width}px`,async({page},info)=>{
 test.skip(info.project.name!=='mobile-390','Phone-size gesture regression');
 await page.setViewportSize({width,height:844});
 const {app,state}=await mountFleet(page,it,{field:fieldProductFixture().field});
 const anchored=async()=>{
  for(const surface of [page.locator('html'),app.locator('html')]){
   expect(await surface.evaluate(n=>n.scrollWidth<=n.clientWidth+1)).toBe(true);
   await surface.evaluate(()=>window.scrollTo(500,window.scrollY));
   expect(await surface.evaluate(()=>window.scrollX)).toBe(0);
  }
 };
 await anchored();
 // A real horizontal gesture must scroll the tabs rather than move the document.
 const tabs=app.locator('.cos-fleet-tabs');
 const bounds=await tabs.boundingBox();
 await page.mouse.move(bounds.x+30,bounds.y+20);
 await page.mouse.wheel(650,0);
 await anchored();
 for(const name of ['Fleet health','Location verification','Needs setup','Data sources']){
  if(it&&name==='Needs setup'){await expect(app.getByRole('button',{name:new RegExp('^'+name)})).toHaveCount(0);await anchored();continue;}
  await app.getByRole('button',{name:new RegExp('^'+name)}).click();
  await anchored();
  if(name==='Fleet health'){
   const table=app.locator('.cos-fleet-health-table table');
   const rect=await table.boundingBox();
   expect(rect.x+rect.width).toBeLessThanOrEqual(width);
   await expect(table.locator('td[data-label="Camera / connection"]').first()).toBeVisible();
   const detail=table.getByRole('button',{name:'Details →'}).first();
   const action=await detail.boundingBox();expect(action.x+action.width).toBeLessThanOrEqual(width);
  }
 }
 const board=app.getByRole('region',{name:'Complete mHelpDesk Fleet command center'});
 await expect(board).toBeVisible();
 for(const card of await board.locator('.cos-command-provider').all()){
  const r=await card.boundingBox();expect(r.x).toBeGreaterThanOrEqual(0);expect(r.x+r.width).toBeLessThanOrEqual(width);
 }
 const search=board.getByRole('searchbox');
 expect(await search.evaluate(n=>parseFloat(getComputedStyle(n).fontSize))).toBeGreaterThanOrEqual(16);
 await search.fill('1006');
 await expect(board.locator('.cos-command-rows')).toContainText('Ranger 902');
 await anchored();
 await page.screenshot({path:info.outputPath(`anchored-${it?'it':'owner'}-${width}.png`),fullPage:true});
 expect(state.calls.every(c=>c.method==='GET')).toBe(true);
 expect(state.errors).toEqual([]);
});

test('embedded Owner host cannot pan sideways',async({page})=>{
 const css=readFileSync(new URL('../../operations-host.css',import.meta.url),'utf8');
 await page.setContent(`<meta name='viewport' content='width=device-width,initial-scale=1'><style>body{margin:0}${css}</style><body class='cos-operations-host'><div id='appView'><section id='view-owner'><div id='cosOperationsMount'><iframe id='cosOperationsFrame' srcdoc='<style>body{margin:0}main{width:100%}</style><main>Fleet workspace</main>'></iframe></div></section></div></body>`);
 await page.mouse.move(180,220);await page.mouse.wheel(600,0);
 expect(await page.evaluate(()=>({x:scrollX,width:document.documentElement.scrollWidth<=innerWidth}))).toEqual({x:0,width:true});
 const frame=await page.locator('#cosOperationsFrame').boundingBox();expect(frame.x+frame.width).toBeLessThanOrEqual(page.viewportSize().width);
});
