import test from 'node:test';
import assert from 'node:assert/strict';
import {readFileSync} from 'node:fs';
import vm from 'node:vm';
const source=readFileSync(new URL('./backend-live.test.mjs',import.meta.url),'utf8').replace(/^import .*;\n/gm,'');
function harness(flag){
 const cases=[],requests=[];
 const context=vm.createContext({assert,process:{env:{COS_RUN_LIVE_SMOKE:flag}},Response,
  test:(name,options,fn)=>cases.push({name,options,fn}),
  fetch:async(url,init)=>{requests.push({url,init});const allowed=init.headers.Origin==='https://cypressriveroasis2023-sudo.github.io';const status=init.method==='OPTIONS'?204:allowed?401:403;return new Response(status===204?null:JSON.stringify({error:allowed?'Please sign in':'Origin denied'}),{status,headers:{'access-control-allow-origin':init.headers.Origin,'cache-control':'no-store','access-control-allow-methods':'GET, POST, OPTIONS'}});}
 });
 vm.runInContext(source,context);return {cases,requests};
}
test('default and non-explicit smoke flags register skips and make zero requests',async()=>{
 for(const flag of [undefined,'','0','true','yes']){
  const h=harness(flag);assert.equal(h.cases.length,3);assert.equal(h.requests.length,0);
  for(const item of h.cases){assert.match(item.options.skip,/Live production smoke is disabled/);if(!item.options.skip)await item.fn();}
  assert.equal(h.requests.length,0);
 }
});
test('explicit smoke opt-in preserves all three auth/CORS checks using mocked transport',async()=>{
 const h=harness('1');assert.equal(h.cases.length,3);assert.equal(h.requests.length,0);
 for(const item of h.cases){assert.equal(item.options.skip,false);await item.fn();}
 assert.equal(h.requests.length,3);assert.equal(h.requests.filter(r=>r.init.method==='POST').length,2);assert.equal(h.requests.filter(r=>r.init.method==='OPTIONS').length,1);
 for(const request of h.requests)assert.equal(Object.hasOwn(request.init.headers,'Authorization'),false);
});
