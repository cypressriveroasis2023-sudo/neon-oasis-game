import test from 'node:test';
import assert from 'node:assert/strict';
import {createMhelpReadinessHandler,projectReadiness,validReadKey} from '../../supabase/functions/cos-mhelp-readiness/index.ts';
import {createCameraMhelpReadinessHandler} from '../../supabase/functions/camera-mhelp-readiness/index.ts';
import {MhelpPartnerError} from '../../supabase/functions/cos-operations-pages/mhelpPartner.ts';
const key='ab'.repeat(32),contract='cos-mhelpdesk-partner-review-v1';
const request=(body={action:'status'})=>new Request('https://synthetic.invalid/check',{method:'POST',headers:{'Content-Type':'application/json','x-cos-mhelp-read-key':key,'x-camera-cron-secret':'synthetic-only'},body:JSON.stringify(body)});
const status={contract,state:'ready_to_test',tokenConfigured:true,portalConfigured:false,liveAccessVerified:false,automaticSync:false};
test('native readiness uses the existing fixed server key and rejects unauthenticated requests before configuration reads',async()=>{
 assert(validReadKey(key,key));assert(validReadKey(key,key.toUpperCase()));for(const other of ['',key.slice(1),'cd'.repeat(32)])assert(!validReadKey(key,other));
 let called=false;const h=createMhelpReadinessHandler({authenticate:()=>false,partner:async()=>{called=true;throw Error('must not read')}});
 assert.equal((await h(request())).status,403);assert.equal(called,false);
});
test('readiness accepts only fixed actions and bounded JSON; caller actor, URL, credentials and filters are rejected',async()=>{
 const calls=[];const h=createMhelpReadinessHandler({authenticate:()=>true,partner:async(...args)=>{calls.push(args);return status}});
 for(const b of [{action:'sync'},{action:'status',actorId:'owner'},{action:'preview',token:'synthetic'},[],{action:'status',url:'https://attacker.invalid'}])assert.equal((await h(request(b))).status,400);
 assert.equal((await h(request({action:'x'.repeat(5000)}))).status,400);
 assert.equal((await h(request())).status,200);assert.deepEqual(calls,[['/api/mhelpdesk/partner/status','GET',{}]]);
});
test('a successful preview publishes counts only and discards labels, identities, customers and credentials',()=>{
 const output=projectReadiness({...status,state:'preview_verified',liveAccessVerified:true,verifiedPortalId:'224643',totalRows:120,partial:true,password:'synthetic-private',items:[{name:'private-name',customerId:'private-id',identity:{state:'review_needed',nativeUnitId:'private-native'}}]});
 assert.equal(output.previewCount,1);assert.equal(output.identities.review_needed,1);assert.equal(output.partial,true);assert(!JSON.stringify(output).includes('private'));assert(!Object.hasOwn(output,'items'));
 assert.throws(()=>projectReadiness({...status,liveAccessVerified:true,items:[]}));
});
test('native failures never echo unknown errors or credentials',async()=>{
 const h=createMhelpReadinessHandler({authenticate:()=>true,partner:async()=>{throw Error('synthetic-private-token')}});const r=await h(request({action:'preview'}));assert.equal(r.status,503);assert(!(await r.text()).includes('synthetic-private'));
 const denied=createMhelpReadinessHandler({authenticate:()=>true,partner:async()=>{throw new MhelpPartnerError('mHelpDesk denied API access. Verify the token, portal, and Partner API approval.')}});
 assert.equal((await denied(request({action:'preview'}))).status,503);
});
test('legacy bridge validates the existing camera cron credential before reading its existing source-read key',async()=>{
 let keyRead=false;const h=createCameraMhelpReadinessHandler({verifyCron:async()=>false,readKey:()=>{keyRead=true;return key},fetch:async()=>{throw Error('must not fetch')}});
 assert.equal((await h(request())).status,403);assert.equal(keyRead,false);
});
test('legacy bridge makes one fixed native request and refuses oversized or credential-bearing replies',async()=>{
 const calls=[];const h=createCameraMhelpReadinessHandler({verifyCron:async()=>true,readKey:()=>key,fetch:async(url,init)=>{calls.push({url,init});return new Response(JSON.stringify(status),{headers:{'Content-Type':'application/json'}})}});
 assert.deepEqual(await (await h(request())).json(),status);assert.equal(calls.length,1);assert.equal(calls[0].url,'https://tughscoxralhofrckvxy.supabase.co/functions/v1/cos-mhelp-readiness');assert.equal(calls[0].init.redirect,'error');assert.equal(calls[0].init.headers['x-cos-mhelp-read-key'],key);assert(!Object.hasOwn(calls[0].init.headers,'x-camera-cron-secret'));
 for(const text of ['x'.repeat(16385),JSON.stringify({...status,private:key}),JSON.stringify({...status,private:'synthetic-secret'})]){
  const failed=createCameraMhelpReadinessHandler({verifyCron:async()=>true,readKey:()=>key,fetch:async()=>new Response(text)});assert.equal((await failed(request())).status,503);
 }
});
