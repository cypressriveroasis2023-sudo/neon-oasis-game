import assert from 'node:assert/strict';
import test from 'node:test';
import vm from 'node:vm';
import {readFileSync} from 'node:fs';
import {execFileSync} from 'node:child_process';
import {verifyAuthOnlyChange} from './verify-techcheck-auth-preservation.mjs';
const app=readFileSync(new URL('../../app.js',import.meta.url),'utf8');
const start=app.indexOf('async function refreshDataInner('),end=app.indexOf('  const prepPromise =',start);
const profilePart=app.slice(start,end)+"return 'profile-verified';}";
const wrapper=app.slice(app.indexOf('async function refreshData(options'),app.indexOf('function appTimeout('));
function fixture(result, source=app){
 const start=source.indexOf('async function refreshDataInner('),end=source.indexOf('  const prepPromise =',start);
 const profilePart=source.slice(start,end)+"return 'profile-verified';}";
 const calls={signOut:0,showAuth:0,reads:0,warnings:0};
 const state={session:{user:{id:'synthetic-owner'}},profile:{role:'owner',full_name:'Synthetic Owner'}};
 const context=vm.createContext({state,refreshInFlight:null,refreshQueued:false,console:{warn(){calls.warnings++;}},scheduleRefreshData(){},
  db:{from(){calls.reads++;return {select(){return this;},eq(){return this;},maybeSingle:async()=>result.value};},auth:{async signOut(){calls.signOut++;}}},
  showAuth(){calls.showAuth++;state.session=null;return 'signed-out';},$:()=>({}),roleLabel:()=>'',configureTabs(){}
 });
 vm.runInContext(profilePart+'\n'+wrapper+'\nglobalThis.refresh=refreshData;globalThis.inner=refreshDataInner;',context);
 return {context,calls,state};
}
for(const status of [0,408,429,500,502,503,504])test('actual host temporary profile read '+status+' does not sign out and the next read works',async()=>{
 const result={value:{data:null,error:{message:'Synthetic temporary failure'},status}},f=fixture(result),session=f.state.session;
 await f.context.refresh();assert.equal(f.calls.signOut,0);assert.equal(f.calls.showAuth,0);assert.equal(f.calls.warnings,1);assert.equal(f.state.session,session);
 result.value={data:{...f.state.profile,active:true},error:null,status:200};await f.context.refresh();assert.equal(f.calls.reads,2);assert.equal(f.calls.signOut,0);assert.equal(f.state.session,session);
});
for(const [name,data,status,error] of [
 ['missing',null,200,null],['inactive',{active:false},200,null],['archived',{active:true,archived_at:'2026-01-01'},200,null],['pending',{active:true,role:'pending'},200,null],
 ['unauthorized',null,401,{message:'Denied'}],['forbidden',null,403,{message:'Denied'}],
])test('actual host '+name+' account still ends access',async()=>{
 const f=fixture({value:{data,error,status}});await f.context.refresh();assert.equal(f.calls.signOut,1);assert.equal(f.calls.showAuth,1);assert.equal(f.state.session,null);
});
test('protected technician preservation allows exactly the intended app replacement and rejects unrelated edits',()=>{
 const baseline=execFileSync('git',['show','f9725fc776f91b7920a7cfc59d3d07c5dd6b53d3:tech-checks/app.js'],{encoding:'utf8'});
 verifyAuthOnlyChange(baseline,app);
 for(const changed of [baseline,app+'\n// extra change',app.replace("role === 'pending'","role === 'allowed'")])assert.throws(()=>verifyAuthOnlyChange(baseline,changed));
});

test('unchanged host reproduces logout on a temporary profile failure',async()=>{
 const baseline=execFileSync('git',['show','f9725fc776f91b7920a7cfc59d3d07c5dd6b53d3:tech-checks/app.js'],{encoding:'utf8'});
 const f=fixture({value:{data:null,error:{message:'Temporary unavailable'},status:503}},baseline);
 await f.context.refresh();assert.equal(f.calls.signOut,1);assert.equal(f.state.session,null);
});

test('email settings reuse the canonical session client without starting a competing auth client',()=>{
 const source=readFileSync(new URL('../../team-email-settings.js',import.meta.url),'utf8').split('\n').slice(0,3).join('\n');
 const canonical={from(){return 'existing-client';}},calls=[];
 const context=vm.createContext({window:{TechCheckDB:canonical},supabase:{createClient(...args){calls.push(args);throw new Error('Duplicate login client');}}});
 vm.runInContext(source+'\nglobalThis.result=emailDb;',context);assert.equal(context.result,canonical);assert.equal(calls.length,0);
});
test('standalone email settings retain one normal fallback client when the host client is absent',()=>{
 const source=readFileSync(new URL('../../team-email-settings.js',import.meta.url),'utf8').split('\n').slice(0,3).join('\n'),fallback={},calls=[];
 const context=vm.createContext({window:{},supabase:{createClient(...args){calls.push(args);return fallback;}}});
 vm.runInContext(source+'\nglobalThis.result=emailDb;',context);assert.equal(context.result,fallback);assert.equal(calls.length,1);assert.equal(calls[0][0],'https://goqrnolcvqnirjmzaeyk.supabase.co');
});
