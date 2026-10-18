-- REVIEW CANDIDATE. Requires named-handoff v1/v2/v3 and daily sign-off v4.
-- No settings, inventory, historical reports or delivery destinations change.
begin;
create function app_private.techcheck_daily_receipts_current_v5(p_actor uuid) returns jsonb
language sql stable security definer set search_path='' as $$
 select coalesce(jsonb_agg(jsonb_build_object('event_id',e.id,'receipt_revision',e.snapshot->'revision','transfer_id',t.id,'transfer_revision',t.revision,'snapshot',e.snapshot,'photos',e.photos,
  'remaining',coalesce((select jsonb_agg(i) from jsonb_array_elements(t.manifest) i where not exists(select 1 from app_private.techcheck_transfer_events r cross join lateral jsonb_array_elements(r.snapshot->'actual') returned where r.transfer_id=t.id and r.kind='return' and returned->>'equipment_key'=i->>'equipment_key')),'[]'::jsonb)) order by t.id),'[]'::jsonb)
 from app_private.techcheck_transfers t join lateral (
  select * from app_private.techcheck_transfer_events x where x.transfer_id=t.id and x.kind='receipt' and x.actor_id=p_actor and x.snapshot->>'state'='accepted' order by (x.snapshot->>'revision')::integer desc limit 1
 ) e on true where t.service_actor=p_actor and t.state in ('accepted','partial_return')
$$;
revoke all on function app_private.techcheck_daily_receipts_current_v5(uuid) from public,anon,authenticated,service_role;
create function public.techcheck_daily_receipts_v5() returns jsonb
language plpgsql stable security definer set search_path='' as $$
begin
 if not app_private.service_daily_actor() then raise exception 'Active Service Tech required.' using errcode='42501';end if;
 if not app_private.techcheck_transfer_ready_v1() then raise exception 'Named handoffs are held for release review.';end if;
 return jsonb_build_object('version',5,'actor_id',auth.uid(),'receipts',app_private.techcheck_daily_receipts_current_v5(auth.uid()));
end$$;
revoke all on function public.techcheck_daily_receipts_v5() from public,anon,service_role;
grant execute on function public.techcheck_daily_receipts_v5() to authenticated;

-- Preserve the complete inspection, photo, truck-stock and signature validation.
-- Only the new v5 wrapper may add receipt linkage before the transaction commits.
alter function app_private.complete_service_daily_report_v4(uuid,jsonb,jsonb,jsonb,jsonb,jsonb) rename to complete_service_daily_report_core_v4;
revoke all on function app_private.complete_service_daily_report_core_v4(uuid,jsonb,jsonb,jsonb,jsonb,jsonb) from public,anon,authenticated,service_role;
create function app_private.complete_service_daily_report_v4(p_report_id uuid,p_units jsonb,p_sims jsonb,p_stock jsonb,p_photos jsonb,p_signature jsonb)
returns jsonb language plpgsql security definer set search_path='' as $$
begin
 if not app_private.service_daily_actor() then raise exception 'Active Service Tech required.' using errcode='42501';end if;
 perform pg_advisory_xact_lock(hashtextextended('techcheck-shared-custody-v6',6));
 if app_private.techcheck_transfer_ready_v1() and not exists(select 1 from app_private.service_daily_reports where id=p_report_id and service_tech_id=auth.uid()) then raise exception 'Reopen your daily check to review and sign the linked equipment receipts.';end if;
 return app_private.complete_service_daily_report_core_v4(p_report_id,p_units,p_sims,p_stock,p_photos,p_signature);
end$$;
revoke all on function app_private.complete_service_daily_report_v4(uuid,jsonb,jsonb,jsonb,jsonb,jsonb) from public,anon;
grant execute on function app_private.complete_service_daily_report_v4(uuid,jsonb,jsonb,jsonb,jsonb,jsonb) to authenticated;
-- Rebind the SQL wrapper after renaming its prior dependency. This also keeps
-- the v1-v3 historical identical-retry behavior through the v4 compatibility API.
create or replace function public.complete_service_daily_report_v4(p_report_id uuid,p_units jsonb,p_sims jsonb,p_stock jsonb,p_photos jsonb,p_signature jsonb)
returns jsonb language sql security invoker set search_path='' as $$select app_private.complete_service_daily_report_v4(p_report_id,p_units,p_sims,p_stock,p_photos,p_signature)$$;

create function public.complete_service_daily_report_v5(p_report_id uuid,p_units jsonb,p_sims jsonb,p_stock jsonb,p_photos jsonb,p_signature jsonb,p_receipts jsonb,p_receipts_reviewed boolean)
returns jsonb language plpgsql security definer set search_path='' as $$
declare actor uuid:=auth.uid();previous app_private.service_daily_reports%rowtype;receipts jsonb;refs jsonb;result jsonb;t record;
 v_request jsonb:=jsonb_build_object('units',p_units,'sims',p_sims,'stock',p_stock,'photos',p_photos,'signature',p_signature,'receipts',p_receipts,'receipts_reviewed',p_receipts_reviewed);
begin
 if not app_private.service_daily_actor() then raise exception 'Active Service Tech required.' using errcode='42501';end if;
 if p_report_id is null then raise exception 'Report ID required.';end if;
 perform pg_advisory_xact_lock(hashtextextended('techcheck-shared-custody-v6',6));
 perform pg_advisory_xact_lock(hashtextextended(actor::text,0));
 select * into previous from app_private.service_daily_reports where id=p_report_id;
 if found then
  if previous.service_tech_id<>actor or previous.request is distinct from v_request then raise exception 'Report ID already used with different signed details.';end if;
  return jsonb_build_object('id',previous.id,'inventory_ready',true,'delivery_status',previous.delivery_status);
 end if;
 if not app_private.techcheck_transfer_ready_v1() then raise exception 'Named handoffs are held for release review.';end if;
 if jsonb_typeof(p_receipts) is distinct from 'array' or jsonb_array_length(p_receipts)>100 or p_receipts_reviewed is distinct from true then raise exception 'Review the exact equipment receipts before signing your daily report.';end if;
 -- Receipt acceptance and each partial return use the same transfer row lock.
 -- Read the final receipt list only after all current rows are locked in order.
 for t in select id from app_private.techcheck_transfers where service_actor=actor and state in ('awaiting_service','discrepancy','accepted','partial_return') order by id for update loop null;end loop;
 receipts:=app_private.techcheck_daily_receipts_current_v5(actor);
 select coalesce(jsonb_agg(jsonb_build_object('event_id',r->'event_id','receipt_revision',r->'receipt_revision','transfer_id',r->'transfer_id','transfer_revision',r->'transfer_revision') order by r->>'transfer_id'),'[]') into refs from jsonb_array_elements(receipts) r;
 if refs is distinct from p_receipts then raise exception 'Equipment receipts changed. Reload, review and sign again.';end if;
 result:=app_private.complete_service_daily_report_core_v4(p_report_id,p_units,p_sims,p_stock,p_photos,p_signature);
 -- This is the newly inserted row in the same transaction, before publication
 -- or delivery. Previously signed reports never reach this update.
 update app_private.service_daily_reports set request=v_request,
  snapshot=jsonb_set(snapshot||jsonb_build_object('receipt_links',receipts),'{signature}',snapshot->'signature'||jsonb_build_object('statement_version',2,'receipt_refs',refs,'statement','I confirm that I physically checked the truck, trailer if applicable, equipment, SIM cards and battery quantities. I reviewed the linked equipment receipt IDs and revisions shown in this report. The answers, images and linked receipts accurately record my checks.'))
 where id=p_report_id;
 return result;
end$$;
revoke all on function public.complete_service_daily_report_v5(uuid,jsonb,jsonb,jsonb,jsonb,jsonb,jsonb,boolean) from public,anon,service_role;
grant execute on function public.complete_service_daily_report_v5(uuid,jsonb,jsonb,jsonb,jsonb,jsonb,jsonb,boolean) to authenticated;
commit;
