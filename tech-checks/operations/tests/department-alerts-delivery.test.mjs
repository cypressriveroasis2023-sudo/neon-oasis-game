import test from 'node:test';
import assert from 'node:assert/strict';
import {makeRawMail,verifiedStaffEmail} from '../../supabase/functions/techcheck-department-alerts/mail.ts';
import {createDepartmentAlertHandler} from '../../supabase/functions/techcheck-department-alerts/index.ts';

const one='77777777-7777-4777-8777-777777777777';
const two='99999999-9999-4999-8999-999999999999';

test('mail source allows only company addresses and preserves a stable Gmail Message-ID',()=>{
 assert.equal(verifiedStaffEmail('  t@camerasonsite.com '),'t@camerasonsite.com');
 assert.equal(verifiedStaffEmail('service@cameras-on-site.invalid'),null);
 assert.equal(verifiedStaffEmail('a@evil.example\r\nBcc:b@evil.example'),null);
 const mail=makeRawMail({id:one,recipient_email:'t@camerasonsite.com',subject:'COS signed handoff',body:'Service\nUnit Spotter 255'});
 const encoded=mail.replace(/-/g,'+').replace(/_/g,'/');
 const raw=atob(encoded+'='.repeat((4-encoded.length%4)%4));
 assert.match(raw,/To: t@camerasonsite.com/);
 assert.match(raw,/Message-ID: <cos-department-77777777-7777-4777-8777-777777777777@camerasonsite.com>/);
 assert.equal(atob(raw.split('\r\n\r\n')[1].trim()),'Service\nUnit Spotter 255');
});
function mockWorker({status=200,who='jmartin@camerasonsite.com',oauth=200}={}){
 const calls=[],sent=[];
 const alerts=[one,two].map((uid,i)=>({
    id:uid,lease_token:'11111111-1111-4111-8111-111111111111',
    recipient_email:i?'vgarcia@camerasonsite.com':'acervantes@camerasonsite.com',
    subject:'COS Alert',body:'Inspect unit in COS'
 }));
 const admin={rpc:async(name,args)=>{
   calls.push(args);
   if(name==='service_daily_cron_authorized_v1')return {data:args.p_secret==='valid'};
   if(name==='techcheck_department_alert_delivery_v1'){
     if(args.p_action==='claim')return {data:alerts.shift()||null};
     return {data:{ok:true}};
   }
   return {error:{message:'Unexpected RPC'}};
 }};
 const fetch=async(url,init)=>{
   if(url.includes('oauth2.googleapis.com'))return new Response(JSON.stringify({access_token:'private-test-token'}),{status:oauth});
   if(url.includes('openidconnect'))return new Response(JSON.stringify({email:who,email_verified:true}),{status:200});
   if(url.includes('gmail.googleapis.com')){sent.push(JSON.parse(init.body));return new Response(JSON.stringify({id:'gmail-'+sent.length}),{status});}
   throw new Error('Unexpected URL');
 };
 return {handler:createDepartmentAlertHandler({admin,env:()=> 'test-secret',fetch}),calls,sent};
}
test('scheduled alerts require server cron and send one message per recipient with Gmail receipts',async()=>{
 const {handler,calls,sent}=mockWorker();
 assert.equal((await handler(new Request('https://internal.invalid',{method:'POST'}))).status,401);
 assert.equal((await handler(new Request('https://internal.invalid',{method:'POST',headers:{'x-techcheck-cron':'bad'}}))).status,401);
 const resp=await handler(new Request('https://internal.invalid',{method:'POST',headers:{'x-techcheck-cron':'valid'}}));
 assert.equal(resp.status,200);
 assert.equal((await resp.json()).sent,2);
 assert.equal(sent.length,2);
 assert.equal(calls.filter(x=>x.p_action==='begin_send').length,2);
 assert.equal(calls.filter(x=>x.p_action==='sent').length,2);
});
test('unconfirmed Gmail send moves to review rather than retrying duplicate emails',async()=>{
 const {handler,calls}=mockWorker({status:503});
 const resp=await handler(new Request('https://internal.invalid',{method:'POST',headers:{'x-techcheck-cron':'valid'}}));
 assert.equal((await resp.json()).review,2);
 assert.equal(calls.filter(x=>x.p_action==='review').length,2);
 assert.equal(calls.filter(x=>x.p_action==='retry').length,0);
});
test('Google account mismatch retries BEFORE attempting to send',async()=>{
 const {handler,calls,sent}=mockWorker({who:'not-owner@camerasonsite.com'});
 const resp=await handler(new Request('https://internal.invalid',{method:'POST',headers:{'x-techcheck-cron':'valid'}}));
 assert.equal((await resp.json()).retry,2);
 assert.equal(sent.length,0);
 assert.equal(calls.filter(x=>x.p_action==='retry').length,2);
});
