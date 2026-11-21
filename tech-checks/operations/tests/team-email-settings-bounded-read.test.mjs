import test from 'node:test';
import assert from 'node:assert/strict';
import vm from 'node:vm';
import {readFileSync} from 'node:fs';
const source=readFileSync(new URL('../../team-email-settings.js',import.meta.url),'utf8');
function load({fail=()=>false}={}){
 const state={now:1_000_000,reads:0,observer:null,boxes:new Set(),release:null,hold:false};
 const card={querySelector:sel=>sel.includes('name_')?{id:'name_u1'}:sel.includes('data-team-email-box')?(state.boxes.has('u1')?{}:null):null,appendChild(){state.boxes.add('u1');},insertAdjacentHTML(){state.boxes.add('u1');},append(){state.boxes.add('u1');}};
 const shown={classList:{contains:()=>false}};
 const document={body:{},head:{appendChild(){},append(){}},getElementById:id=>id==='appView'||id==='view-owner'?shown:null,querySelectorAll:sel=>sel==='.teamMemberCard'?[card]:[],createElement:()=>({style:{},set innerHTML(v){},querySelector:()=>null,addEventListener(){},setAttribute(){},dataset:{}}),querySelector:()=>null};
 class Clock extends Date{static now(){return state.now;}}
 const db={from:()=>({select:async()=>{state.reads++;if(state.hold)await new Promise(r=>state.release=r);return fail(state.reads)?{data:null,error:{message:'timeout'}}:{data:[{user_id:'u1'}],error:null};}}),functions:{invoke:async()=>({})}};
 const context=vm.createContext({window:{TechCheckDB:db},document,Date:Clock,Promise,Map,Set,Math,String,Boolean,Object,console,alert(){},setTimeout:()=>0,clearTimeout(){},MutationObserver:class{constructor(f){state.observer=f;}observe(){}}});
 vm.runInContext(source+'\n;globalThis.__load=loadTeamEmailSettings;globalThis.__read=readTeamEmailProfiles;',context);
 return {state,load:()=>context.__load(),read:()=>context.__read()};
}
test('overlapping requests share one profile read',async()=>{
 const w=load();w.state.hold=true;const calls=[w.read(),w.read(),w.read()];await Promise.resolve();
 assert.equal(w.state.reads,1);w.state.release();await Promise.all(calls);assert.equal(w.state.reads,1);
});
test('a recent answer is reused for a minute, then one new read is made',async()=>{
 const w=load();await w.read();for(let i=0;i<500;i++){w.state.now+=100;await w.read();}
 assert.equal(w.state.reads,1);w.state.now+=60_000;await w.read();assert.equal(w.state.reads,2);
});
test('a failing source is asked on a backoff, not on every page change',async()=>{
 const w=load({fail:()=>true});
 // One hour of page changes, one each second, while every read fails.
 for(let second=0;second<3600;second++){await w.read();w.state.now+=1000;}
 // 5s, 10s, 20s ... capped at 5 minutes: 17 reads in the hour instead of 3,600.
 assert.equal(w.state.reads,17);
});
test('recovery after failures clears the backoff',async()=>{
 const w=load({fail:n=>n<=2});await w.read();w.state.now+=5000;await w.read();w.state.now+=10_000;
 assert.deepEqual(JSON.parse(JSON.stringify(await w.read())),[{user_id:'u1'}]);assert.equal(w.state.reads,3);
});
test('once every card has its email box, page changes read nothing',async()=>{
 const w=load();w.state.boxes.add('u1');for(let i=0;i<200;i++){w.state.now+=120_000;await w.load();}
 assert.equal(w.state.reads,0);
});
