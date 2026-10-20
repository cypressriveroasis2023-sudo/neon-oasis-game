import {test,expect} from '@playwright/test';
import {mountFleet} from './fleet-dashboard-fixtures.mjs';
import {statusPinsFixture} from './fixtures/fleet-status-pins-fixture.mjs';
for(const it of [false,true])test(`dense Fleet switches between grouped and individually selectable pins ${it?'IT':'Owner'}`,async({page},info)=>{
 const f=statusPinsFixture();
 f.field.mhelpAddressMap.items.forEach((pin,i)=>{if(i<21)Object.assign(pin,{status:'matched',reason:null,matchedAddress:'123 EXAMPLE RD, HOUSTON, TX, 77064',latitude:30,longitude:-96});});
 const original=structuredClone(f.field),{app,state}=await mountFleet(page,it,{field:f.field});
 const groups=app.locator('.cos-compact-group-marker'),individual=app.getByRole('button',{name:'Individual pins',exact:true}),grouped=app.getByRole('button',{name:'Grouped',exact:true});
 await expect(groups).toHaveCount(1);await expect(groups).toHaveAttribute('data-group-count','21');
 await expect(grouped).toHaveAttribute('aria-pressed','true');
 const groupIds=JSON.parse(await groups.getAttribute('data-mhelp-product-ids')).sort();
 const view=()=>app.locator('body').evaluate(()=>({center:history.state.cosFieldMapView.center,zoom:history.state.cosFieldMapView.zoom}));
 const before=await view();
 await individual.click();await expect(individual).toHaveAttribute('aria-pressed','true');await expect(individual).toHaveCSS('background-color','rgb(7, 89, 200)');await expect(groups).toHaveCount(0);
 const pins=app.locator('.cos-mhelp-address-marker');await expect(pins).toHaveCount(21);
 expect(await pins.evaluateAll(nodes=>nodes.map(n=>n.dataset.mhelpProductId).sort())).toEqual(groupIds);
 await expect(pins.locator('.cos-unit-pin-drop path')).toHaveCount(21);
 expect(await pins.evaluateAll(nodes=>nodes.every(n=>n.dataset.sourcePoint==='[30,-96]'))).toBe(true);
 const boxes=await pins.evaluateAll(nodes=>nodes.map(n=>n.getBoundingClientRect().toJSON()));
 for(let i=0;i<boxes.length;i++){expect(boxes[i].width).toBeGreaterThanOrEqual(44);expect(boxes[i].height).toBeGreaterThanOrEqual(44);for(let j=i+1;j<boxes.length;j++){const a=boxes[i],b=boxes[j];expect(a.right<=b.left||b.right<=a.left||a.bottom<=b.top||b.bottom<=a.top).toBeTruthy();}}
 for(const [id,status] of [['1001','online'],['1002','offline'],['1003','unknown'],['1004','support']])await expect(app.locator(`[data-mhelp-product-id="${id}"]`)).toHaveAttribute('data-health',status);
 await app.locator('[data-mhelp-product-id="1001"]').click();await expect(app.getByRole('dialog')).toContainText('Product 1001');await page.keyboard.press('Escape');
 await expect.poll(view).toEqual(before);
 await app.getByLabel('Fleet map details',{exact:true}).click();
 const picker=app.getByLabel('Find mapped equipment');expect(await picker.locator('option').count()).toBe(22);
 await picker.selectOption(groupIds.at(-1));await expect(app.getByRole('dialog')).toContainText('Product '+groupIds.at(-1));await page.keyboard.press('Escape');
 await app.getByLabel('Fleet map details',{exact:true}).click();
 await app.getByRole('navigation',{name:'Fleet dashboard views'}).getByRole('button',{name:/Fleet health/}).click();
 await app.getByRole('navigation',{name:'Fleet dashboard views'}).getByRole('button',{name:/Map/}).click();
 await expect(individual).toHaveAttribute('aria-pressed','true');await expect(pins).toHaveCount(21);await expect.poll(view).toEqual(before);
 await app.getByRole('button',{name:'Fullscreen fleet map',exact:true}).click();await expect(individual).toHaveAttribute('aria-pressed','true');await expect(groups).toHaveCount(0);
 await page.mouse.move(0,0);await app.locator('.cos-fleet-map-panel').screenshot({path:info.outputPath('individual-pin-view.png')});await page.keyboard.press('Escape');
 await grouped.click();await expect(groups).toHaveCount(1);expect(JSON.parse(await groups.getAttribute('data-mhelp-product-ids')).sort()).toEqual(groupIds);await expect.poll(view).toEqual(before);
 await expect(app.locator('.cos-address-review-flag')).toHaveCount(0);expect(state.field).toEqual(original);expect(state.errors).toEqual([]);expect(state.calls.every(c=>c.method==='GET')).toBe(true);
});
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
