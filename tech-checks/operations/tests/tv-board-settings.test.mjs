import test from 'node:test';
import assert from 'node:assert/strict';
import {readFile} from 'node:fs/promises';
import {PGlite} from '@electric-sql/pglite';
import {checkedTvSections,checkedTvSettings} from '../../supabase/functions/cos-operations-pages/tv-board-settings/index.ts';
import {configuredTvPages} from '../src/tvBoardData.ts';
import {dailyBoardCards,readinessSummary} from '../src/dailyBoardData.ts';
import {vehicleInspectionExempt} from '../src/vehicleInspectionPolicy.ts';
import {createOperationsHandler} from '../../supabase/functions/cos-operations-pages/index.ts';
const org='ece6d2a2-fd19-4cc7-b56a-2fa004a6d8f5',owner='3f073784-96e7-43d8-b9e0-33ab31c3c8b1',tech='d0757b64-9623-4adc-afff-21cc7853e88a';
test('only supported TV sections are saved, including intentionally turning every section off',()=>{
 assert.deepEqual(checkedTvSections(['map','today']),['today','map']);assert.deepEqual(checkedTvSections([]),[]);
 for(const value of [['today','today'],['secret'],null,{},['camera',null]])assert.throws(()=>checkedTvSections(value));
 assert.throws(()=>checkedTvSettings({sections:['map'],revision:-1,updatedAt:null}));
});
test('today jobs and all pending type queues remain distinct and hidden sections never rotate',()=>{
 const now=new Date('2026-10-12T15:00:00Z');
 const jobs=[{id:'today',jobType:'SERVICE',scheduled:'2026-10-12 08:00',status:'scheduled'},{id:'future',jobType:'PICKUP',scheduled:'2026-11-01 08:00',status:'scheduled'},{id:'none',jobType:'SWAP',status:'unscheduled'},{id:'done',jobType:'PICKUP',status:'completed',completedAt:'2026-10-12T14:00:00Z'},{id:'cancelled',jobType:'DELIVERY',status:'cancelled'}];
 const cards=dailyBoardCards(jobs,[],now,'day',true);
 const pages=configuredTvPages(cards,[],[],['today','pickup','swap'],1440,900,'2026-10-12');
 const ids=section=>pages.filter(p=>p.section===section).flatMap(p=>p.kind==='work'?p.lanes.flatMap(l=>l.cards.map(c=>c.record.id)):[]);
 assert.deepEqual(ids('today').sort(),['done','today']);assert.deepEqual(ids('pickup'),['future']);assert.deepEqual(ids('swap'),['none']);
 assert.equal(pages.some(p=>p.kind==='camera'||p.kind==='map'||p.kind==='readiness'),false);
 assert.equal(configuredTvPages(cards,[],[],[],390,844,'2026-10-12')[0].kind,'empty');
});
test('Teddy and Victor have no vehicle requirements without marking checks complete or exempting others',()=>{
 for(const name of ['Teddy Hopper','Victor Garcia']){const row={userId:'existing',name,department:'it',status:'not_started',result:{}};assert.equal(vehicleInspectionExempt(row),true);assert.equal(readinessSummary(row).truck.label,'No company vehicle');assert.equal(readinessSummary(row).truck.state,'neutral');assert.equal(readinessSummary(row).trailer.state,'neutral');assert.equal(readinessSummary(row).inventory.label,'Not started');}
 assert.equal(readinessSummary({userId:'other',name:'Service Tech',department:'service',status:'not_started',result:{}}).truck.state,'pending');
 assert.equal(vehicleInspectionExempt({userId:tech,name:'Renamed existing account'}),true);
});
test('SQL persists shared choices, refuses stale overwrites and denies technician and direct browser access',async()=>{
 const db=new PGlite();
 await db.exec(`create schema auth;create schema app_private;create role anon;create role authenticated;create role service_role bypassrls;
 create table auth.users(id uuid primary key);create table public.organizations(id uuid primary key);
 create table public.user_profiles(user_id uuid,organization_id uuid,active boolean,department text);create table public.roles(id uuid,organization_id uuid,code text);create table public.user_roles(user_id uuid,role_id uuid);create table public.role_permissions(role_id uuid,permission_code text);
 insert into auth.users values('${owner}'),('${tech}');insert into organizations values('${org}');
 insert into user_profiles values('${owner}','${org}',true,'owner'),('${tech}','${org}',true,'it');
 insert into roles values('${owner}','${org}','owner'),('${tech}','${org}','it_technician');insert into user_roles values('${owner}','${owner}'),('${tech}','${tech}');
 insert into role_permissions values('${owner}','job.override');
 grant usage on schema auth to service_role;grant select on user_profiles,user_roles,roles,role_permissions to service_role;
 create function app_private.appdeploy_assume_actor(a uuid,o uuid) returns void language plpgsql as $$begin perform set_config('request.jwt.claim.sub',a::text,true);end$$;
 create function app_private.has_permission(o uuid,p text) returns boolean language sql as $$select current_setting('request.jwt.claim.sub',true)='${owner}'$$;
 `);
 await db.exec(await readFile(new URL('../../database-maintenance/tech-check-tv-settings.sql',import.meta.url),'utf8'));
 const call=(name,args)=>db.query(`select public.${name}(${args}) as value`);
 await db.exec('set role service_role');
 assert.equal((await call('cos_tv_board_settings_snapshot',`'${owner}','${org}'`)).rows[0].value.revision,0);
 const saved=(await call('cos_tv_board_settings_save',`'${owner}','${org}',array['pickup','map'],0`)).rows[0].value;
 assert.deepEqual(saved.sections,['pickup','map']);assert.equal(saved.revision,1);
 await assert.rejects(call('cos_tv_board_settings_save',`'${owner}','${org}',array['camera'],0`),/changed on another computer/);
 await assert.rejects(call('cos_tv_board_settings_snapshot',`'${tech}','${org}'`),/active existing COS Owner/);
 assert.deepEqual((await call('cos_tv_board_settings_save',`'${owner}','${org}',array[]::text[],1`)).rows[0].value.sections,[]);
 await db.exec('set role authenticated');await assert.rejects(call('cos_tv_board_settings_snapshot',`'${owner}','${org}'`),/permission denied/);
 await db.exec('set role anon');await assert.rejects(db.query('select * from app_private.cos_tv_board_settings'),/permission denied/);
 await db.close();
});
test('TV API uses the existing authenticated Owner actor and rejects client identity fields',async()=>{
 const writes=[];
 const handler=createOperationsHandler({serviceKey:'synthetic-service-only',platformUrl:'https://fixture.invalid',fetch:async(url,init)=>{
  let data;if(url.includes('/auth/v1/user'))data={id:'e4abc521-1ef3-45a6-9829-b87faff78210'};
  else if(url.includes('/profiles?'))data=[{user_id:'e4abc521-1ef3-45a6-9829-b87faff78210',role:'owner',active:true,archived_at:null}];
  else if(url.includes('/user_profiles?'))data=[{user_id:owner,department:'owner',active:true}];
  else if(url.includes('/user_roles?'))data=[{role_id:owner,roles:{code:'owner',organization_id:org}}];
  else if(url.includes('/rpc/')){writes.push({url,body:JSON.parse(init.body)});data={sections:['map'],revision:1,updatedAt:'2026-10-12T15:00:00Z'};}
  else throw Error('Unexpected request '+url);
  return Response.json(data);
 }});
 const request=(body,auth='Bearer synthetic-owner')=>handler(new Request('https://fixture.invalid/functions/v1/cos-operations-pages',{method:'POST',headers:{authorization:auth,'content-type':'application/json'},body:JSON.stringify(body)}));
 const response=await request({path:'/api/tv-board/settings',method:'POST',body:{sections:['map'],expectedRevision:0}});assert.equal(response.status,200);assert.equal(writes.length,1);assert.equal(writes[0].body.p_actor_user_id,owner);assert.equal(writes[0].body.p_organization_id,org);
 assert.equal((await request({path:'/api/tv-board/settings',method:'POST',body:{sections:['map'],expectedRevision:1,actorId:tech}})).status,400);assert.equal(writes.length,1);
 assert.equal((await request({path:'/api/tv-board/settings',method:'GET'},'')).status,401);
});
