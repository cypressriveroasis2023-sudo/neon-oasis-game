\set ON_ERROR_STOP on
-- CI-only empty PostgreSQL fixture. Never run this fixture in production.
create role anon;create role authenticated;create role service_role;
create schema app_private;create schema cos_mhelp_placement_private;
create table app_private.owner_test_source(value jsonb);
insert into app_private.owner_test_source values(jsonb_build_object('complete',true,'sourceSha256',repeat('a',64),'apiSync',jsonb_build_object('lastSuccessAt',now()),'records',jsonb_build_array(jsonb_build_object('productId','1006','unitNumber','Synthetic 006','category','Spotter','placement','FIELD','customer','Fixture','sourceAddress',jsonb_build_object('street','100 Synthetic Road'),'lifecycle','UNFLAGGED'),jsonb_build_object('productId','1008','unitNumber','Synthetic 008','category','Spotter','placement','SHOP','customer','Fixture','sourceAddress',jsonb_build_object('street','Shop'),'lifecycle','UNFLAGGED'))));
create function cos_mhelp_placement_private.upload_snapshot() returns jsonb language sql as $$select value from app_private.owner_test_source$$;
create function app_private.cos_owner_identity_assert_actor(p_actor uuid,p_org uuid,p_write boolean) returns void language plpgsql as $$begin if p_actor is distinct from '00000000-0000-4000-8000-000000000001'::uuid or p_org is distinct from 'ece6d2a2-fd19-4cc7-b56a-2fa004a6d8f5'::uuid then raise exception 'Owner required' using errcode='42501';end if;end$$;
\ir ../db/owner-equipment-controls.sql
begin;
do $$declare actor uuid:='00000000-0000-4000-8000-000000000001';request uuid:=gen_random_uuid();v jsonb;ticket jsonb;settings jsonb:='{"placement":"FIELD","customer":"Fixture","site":"Test","address":"100 Synthetic Road","publicIp":"8.8.8.8","ports":[1500,1400],"monitoringEnabled":true,"latitude":null,"longitude":null}';begin
 if has_function_privilege('authenticated','public.cos_owner_equipment_save_v1(uuid,text,bigint,uuid,text,jsonb,text)','EXECUTE') or has_function_privilege('anon','public.cos_owner_equipment_record_v1(text)','EXECUTE') then raise exception 'Public privilege leak';end if;
 begin perform public.cos_owner_equipment_save_v1(null,'1006',0,request,'save',settings,'Test');raise exception 'Invalid Owner accepted';exception when insufficient_privilege then null;end;
 begin perform public.cos_owner_equipment_save_v1(actor,'1006',null,request,'save',settings,'Test');raise exception 'Null revision accepted';exception when invalid_parameter_value then null;end;
 v:=public.cos_owner_equipment_save_v1(actor,'1006',0,request,'save',settings,'Test');
 if v->>'revision'<>'1' or v->>'connectionRevision'<>'1' or v->'settings'->'ports'<>'[1400,1500]'::jsonb then raise exception 'Save mismatch';end if;
 v:=public.cos_owner_equipment_save_v1(actor,'1006',0,request,'save',settings,'Test');if v->>'replayed'<>'true' then raise exception 'Idempotency failed';end if;
 begin perform public.cos_owner_equipment_save_v1(actor,'1006',0,gen_random_uuid(),'save',settings,'Stale');raise exception 'Stale save accepted';exception when serialization_failure then null;end;
 begin perform public.cos_owner_equipment_save_v1(actor,'1008',0,gen_random_uuid(),'save',settings,'Conflict');raise exception 'Duplicate IP accepted';exception when unique_violation then null;end;
 v:=public.cos_owner_equipment_save_v1(actor,'1006',1,gen_random_uuid(),'save',jsonb_set(settings,'{address}','"200 Synthetic Road"'),'Address correction');if v->>'revision'<>'2' or v->>'connectionRevision'<>'1' then raise exception 'Address edit changed connection revision';end if;
 ticket:=public.cos_owner_equipment_check_v1('1006','begin');if ticket->>'state'<>'ready' then raise exception 'Cannot begin check';end if;
 if (public.cos_owner_equipment_check_v1('1006','begin'))->>'state'<>'already_running' then raise exception 'Concurrent check permitted';end if;
 v:=public.cos_owner_equipment_check_v1('1006','finish',(ticket->>'ticket')::uuid,1,jsonb_build_object('status','online','publicIp','8.8.8.8','ports','[1400,1500]'::jsonb,'checkedAt',now(),'outcomes','[{"port":1400,"outcome":"responded"},{"port":1500,"outcome":"no_response"}]'::jsonb));if v->>'checkSaved'<>'true' then raise exception 'Check not saved';end if;
 ticket:=public.cos_owner_equipment_check_v1('1006','begin');v:=public.cos_owner_equipment_check_v1('1006','finish',(ticket->>'ticket')::uuid,1,'{"status":"unknown","reason":"Synthetic technical failure"}'::jsonb);if v->'lastCompleted'->>'status'<>'online' or v->>'checkSaved'<>'false' then raise exception 'Failure erased completed evidence';end if;
 ticket:=public.cos_owner_equipment_check_v1('1006','begin');perform public.cos_owner_equipment_save_v1(actor,'1006',2,gen_random_uuid(),'save',jsonb_set(settings,'{publicIp}','"8.8.4.4"'),'Target changed');v:=public.cos_owner_equipment_check_v1('1006','finish',(ticket->>'ticket')::uuid,1,'{"status":"unknown"}'::jsonb);if v->>'saved'<>'false' then raise exception 'Old target check accepted';end if;
 v:=public.cos_owner_equipment_save_v1(actor,'1006',3,gen_random_uuid(),'release','{}','Use source');if v->>'active'<>'false' then raise exception 'Release failed';end if;
 if (select count(*) from cos_owner_equipment_private.audit)<>4 then raise exception 'Unexpected audit count';end if;
 if not (select relrowsecurity from pg_class where oid='cos_owner_equipment_private.settings'::regclass) then raise exception 'RLS disabled';end if;
 raise notice 'Owner persistence, conflict, privilege, idempotency, revision, lease, retention and release checks passed.';
end $$;
select jsonb_array_length(public.cos_owner_equipment_list_v1()) as validated_list_call;
rollback;
