import {test,expect} from '@playwright/test';
import {mountFleet} from './fleet-dashboard-fixtures.mjs';
import {statusPinsFixture} from './fixtures/fleet-status-pins-fixture.mjs';
for(const it of [false,true])test(`nearby sites stay as several readable circles ${it?'IT':'Owner'}`,async({page},info)=>{
 const f=statusPinsFixture();
 f.field.mhelpAddressMap.items.forEach((p,i)=>{if(i<7){p.latitude=30;p.longitude=-96+i*.04;}});
 const {app,state}=await mountFleet(page,it,{field:f.field});
 const markers=app.locator('.cos-mhelp-address-marker');
 await expect.poll(()=>markers.count()).toBeGreaterThanOrEqual(3);
 expect((await app.locator('.cos-fleet-map-toolbar').boundingBox()).height).toBeLessThanOrEqual(76);
 await app.getByLabel('Fleet map details',{exact:true}).click();
 await expect(app.locator('.cos-fleet-map-details small')).toBeVisible();
 await expect(app.locator('.cos-fleet-map-details small')).toContainText('7 MHelp customer address units');
 await app.getByLabel('Fleet map details',{exact:true}).click();
 const products=await markers.evaluateAll(nodes=>nodes.flatMap(n=>JSON.parse(n.getAttribute('data-mhelp-product-ids'))).sort());
 expect(products).toEqual(['1001','1002','1003','1004','1005','1006','1007']);
 const boxes=await markers.evaluateAll(nodes=>nodes.map(n=>n.getBoundingClientRect().toJSON()));
 for(let i=0;i<boxes.length;i++)for(let j=i+1;j<boxes.length;j++){const a=boxes[i],b=boxes[j];expect(a.right<=b.left||b.right<=a.left||a.bottom<=b.top||b.bottom<=a.top).toBeTruthy();}
 await expect(app.locator('.cos-address-review-flag')).toHaveCount(0);
 await expect(markers.locator('svg path')).toHaveCount(0);
 for(const id of products){
  const index=await markers.evaluateAll((nodes,id)=>nodes.findIndex(n=>JSON.parse(n.getAttribute('data-mhelp-product-ids')).includes(id)),id);
  await markers.nth(index).click();
  const dialog=app.getByRole('dialog',{name:'MHelp address group'});
  if(await dialog.count())await dialog.getByRole('button',{name:new RegExp('Product '+id+'$')}).click();
  await expect(app.getByRole('dialog')).toContainText('Product '+id);
  await page.keyboard.press('Escape');
 }
 await app.locator('.cos-fleet-map-panel').screenshot({path:info.outputPath('separate-nearby-sites.png')});
 expect(state.errors).toEqual([]);expect(state.calls.every(c=>c.method==='GET')).toBeTruthy();
});
for(const it of [false,true])test(`dense address groups stay clean and every product opens ${it?'IT':'Owner'}`,async({page},info)=>{
 const f=statusPinsFixture();
 f.field.mhelpAddressMap.items.forEach((p,i)=>{if(i<7){p.latitude=30+i*.00001;p.longitude=-96+i*.00001;}});
 const original=structuredClone(f.field);
 const {app,state}=await mountFleet(page,it,{field:f.field});
 const group=app.locator('.cos-mhelp-address-marker');
 await expect(group).toHaveCount(1);
 await expect(group.locator('.cos-address-pin-count')).toHaveText('7');
 await expect(app.locator('.cos-dashboard-marker')).toHaveCount(0);
 await expect(group).toHaveAttribute('data-health','mixed');
 await expect(group.locator('.cos-status-group-ring')).toHaveCount(1);
 await expect(app.locator('.cos-address-review-flag')).toHaveCount(0);
 await expect(group.locator('.cos-address-pin-art')).toHaveCSS('width','32px');
 expect(JSON.parse(await group.getAttribute('data-mhelp-product-ids')).sort()).toEqual(['1001','1002','1003','1004','1005','1006','1007']);
 await group.scrollIntoViewIfNeeded();
 const groupBox=await group.boundingBox(),canvasBox=await app.locator('.cos-fleet-map-canvas').boundingBox();
 expect(Math.abs(groupBox.x+groupBox.width/2-canvasBox.x-canvasBox.width/2)).toBeLessThan(30);
 await group.click();
 const dialog=app.getByRole('dialog',{name:'MHelp address group'});
 await expect(dialog.locator('.cos-mhelp-address-group-item')).toHaveCount(7);
 await expect(dialog.locator('.cos-signal-online')).toContainText('Online');
 await expect(dialog.locator('.cos-signal-offline')).toContainText('Offline');
 await expect(dialog.locator('.cos-signal-support')).toContainText('Solar support');
 for(const id of ['1001','1002','1003','1004','1005','1006','1007']){
  await dialog.getByRole('button',{name:new RegExp('Product '+id+'$')}).click();
  await expect(app.getByRole('dialog')).toContainText('Product '+id);
  if(id==='1001'){await expect(app.getByRole('dialog')).toContainText('Original mHelpDesk address');await expect(app.getByRole('dialog').locator('.cos-mhelp-address-warning')).toHaveCount(0);await expect(app.getByRole('dialog')).not.toContainText('Compare both addresses');await app.getByRole('button',{name:'Camera & unit details',exact:true}).click();await expect(app.locator('.cos-fleet-troubleshooting')).toHaveCount(1);}
  await page.keyboard.press('Escape');if(id==='1001'){await app.getByRole('button',{name:'Fit pins',exact:true}).click();await app.locator('.cos-fleet-map-panel').scrollIntoViewIfNeeded();}await group.click();
 }
 await page.keyboard.press('Escape');
 await app.locator('.cos-fleet-map-panel').screenshot({path:info.outputPath('clean-dense-group.png')});
 expect(state.field).toEqual(original);
 expect(state.calls.every(c=>c.method==='GET')).toBeTruthy();expect(state.errors).toEqual([]);
});
for(const it of [false,true])test(`a slow power read does not block camera refresh ${it?'IT':'Owner'}`,async({page})=>{
 const {app,state}=await mountFleet(page,it,{holdVrm:true});
 await expect(app.locator('.cos-fleet-stat-online strong')).not.toHaveText('—');
 await expect(app.getByRole('button',{name:'↻ Refresh data',exact:true})).toBeEnabled();
 state.failVrm=true;state.releaseVrm();
 await expect(app.getByRole('alert')).toContainText('Synthetic saved power read unavailable');
 await expect(app.locator('.cos-fleet-stat-online strong')).not.toHaveText('—');
 await expect(app.getByRole('button',{name:'↻ Refresh data',exact:true})).toBeEnabled();
 expect(state.errors).toEqual([]);
});
for(const size of [{width:844,height:390},{width:932,height:430}])test(`touch landscape ${size.width} keeps groups clear and selectable`,async({browser},info)=>{
 const context=await browser.newContext({viewport:size,hasTouch:true});
 try{const page=await context.newPage(),{app,state}=await mountFleet(page,false,{field:statusPinsFixture().field});
 await app.locator('.cos-fleet-map-panel').scrollIntoViewIfNeeded();
 await expect.poll(()=>app.locator('.cos-mhelp-address-marker').first().evaluate(n=>n.getBoundingClientRect().width)).toBe(44);
 const boxes=await app.locator('.cos-mhelp-address-marker,.cos-dashboard-marker').evaluateAll(nodes=>nodes.map(n=>n.getBoundingClientRect().toJSON()).filter(b=>b.width));
 for(let i=0;i<boxes.length;i++)for(let j=i+1;j<boxes.length;j++){const a=boxes[i],b=boxes[j];expect(a.right<=b.left||b.right<=a.left||a.bottom<=b.top||b.bottom<=a.top).toBeTruthy();}
 await app.locator('.cos-mhelp-address-marker').first().tap();await expect(app.getByRole('dialog')).toBeVisible();await page.keyboard.press('Escape');
 expect(await app.locator('html').evaluate(e=>e.scrollWidth<=e.clientWidth+1)).toBeTruthy();
 await app.locator('.cos-fleet-map-panel').screenshot({path:info.outputPath('touch-groups.png')});expect(state.errors).toEqual([]);
 }finally{await context.close();}
});
