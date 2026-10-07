import test from 'node:test';import assert from 'node:assert/strict';import {readFileSync} from 'node:fs';import vm from 'node:vm';
const context=vm.createContext({Intl});vm.runInContext(readFileSync(new URL('../../camera-health-history.js',import.meta.url),'utf8'),context);vm.runInContext(readFileSync(new URL('../../camera-health-overview.js',import.meta.url),'utf8'),context);
const row={id:1,unit_key:'SNIPER 001',activation_state:'active',organization:'Synthetic site',device_type:'Sniper'};
const group={k:'SNIPER 001',ds:[row],scope:'field',state:'service',serviceState:'online',providerState:'verifying'};
const options={effectiveHealth:()=> 'online',cameraGroup:()=> 'Sniper',isShop:()=>false};
test('front action is a separate button, keeps exact escaped unit, and uses existing eligibility',()=>{
 let html=context.CameraHealthOverview.card(group,{...options,canManage:true});assert.match(html,/<article class="unitcard compact-unit online"/);assert.match(html,/class="unit-card-open"/);assert.match(html,/<\/button>[\s\S]*<button[^>]+send-root-unit/);assert.match(html,/data-unit="SNIPER 001"\s*>Move to ROOT \/ SHOP/);let depth=0;for(const tag of html.match(/<\/?button\b[^>]*>/g)||[]){depth+=tag.startsWith('</')?-1:1;assert.ok(depth>=0&&depth<=1);}assert.equal(depth,0);
 for(const change of [{scope:'shop'},{scope:'inactive'},{ds:[{...row,__trackerOnly:true}]}])assert.doesNotMatch(context.CameraHealthOverview.card({...group,...change},{...options,canManage:true}),/front-shop-action/);
 assert.doesNotMatch(context.CameraHealthOverview.card(group,options),/front-shop-action/);
 html=context.CameraHealthOverview.card({...group,k:'SNIPER <one> "quoted"'},{...options,canManage:true});assert.match(html,/SNIPER &lt;one&gt; &quot;quoted&quot;/);
});
