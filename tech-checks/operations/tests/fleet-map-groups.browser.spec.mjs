import {test,expect} from '@playwright/test';
import {mountFleet} from './fleet-dashboard-fixtures.mjs';
import {statusPinsFixture} from './fixtures/fleet-status-pins-fixture.mjs';
for(const dense of [false,true])for(const it of [false,true])test(`${dense?'shared-address':'nearby'} individual pin drops ${it?'IT':'Owner'}`,async({page},info)=>{
 const f=statusPinsFixture();f.field.mhelpAddressMap.items.forEach((p,i)=>{if(i<7){p.latitude=30;p.longitude=-96+(dense?0:i*.04);}});
 const original=structuredClone(f.field),{app,state}=await mountFleet(page,it,{field:f.field}),markers=app.locator('.cos-mhelp-address-marker');
 await expect(markers).toHaveCount(7);await expect(app.locator('.cos-dashboard-cluster,.cos-map-group,.cos-status-group-ring,.cos-address-review-flag')).toHaveCount(0);
 expect((await app.locator('.cos-fleet-map-toolbar').boundingBox()).height).toBeLessThanOrEqual(76);
 const ids=await markers.evaluateAll(nodes=>nodes.flatMap(n=>JSON.parse(n.dataset.mhelpProductIds)).sort());expect(ids).toEqual(['1001','1002','1003','1004','1005','1006','1007']);
 const boxes=await markers.evaluateAll(nodes=>nodes.map(n=>n.getBoundingClientRect().toJSON()));
 for(let i=0;i<boxes.length;i++){expect(boxes[i].width).toBeGreaterThanOrEqual(44);expect(boxes[i].height).toBeGreaterThanOrEqual(44);for(let j=i+1;j<boxes.length;j++){const a=boxes[i],b=boxes[j];expect(a.right<=b.left||b.right<=a.left||a.bottom<=b.top||b.bottom<=a.top).toBeTruthy();}}
 await expect(markers.locator('.cos-unit-pin-drop path')).toHaveCount(7);
 const view=()=>app.locator('body').evaluate(()=>({center:history.state.cosFieldMapView.center,zoom:history.state.cosFieldMapView.zoom})),before=await view();
 for(const id of ids){await app.locator(`[data-mhelp-product-id="${id}"]`).click();await expect(app.getByRole('dialog')).toContainText('Product '+id);await page.keyboard.press('Escape');await expect.poll(view).toEqual(before);}
 expect(state.field).toEqual(original);expect(state.calls.every(c=>c.method==='GET')).toBeTruthy();expect(state.errors).toEqual([]);
 await page.mouse.move(0,0);await app.locator('.cos-fleet-map-panel').screenshot({path:info.outputPath(dense?'individual-shared-address.png':'individual-nearby-sites.png')});
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
 await page.mouse.move(0,0);await app.locator('.cos-fleet-map-panel').screenshot({path:info.outputPath('touch-groups.png')});expect(state.errors).toEqual([]);
 }finally{await context.close();}
});
