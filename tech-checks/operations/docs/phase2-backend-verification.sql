-- Verification is intentionally non-persistent: all successful changes are rolled back in nested subtransactions.
-- Uses existing authorized production service RPC contracts; do not run as a public browser client.
-- No account provisioning, role grants, schema changes, assignment duplication, creates, or irreversible flows.

do $verification$
declare
 v_actor uuid := '3f073784-96e7-43d8-b9e0-33ab31c3c8b1';
 v_org uuid := 'ece6d2a2-fd19-4cc7-b56a-2fa004a6d8f5';
 v_id uuid; v_before jsonb; v_after jsonb; v_read jsonb; v_result jsonb; v_receipt jsonb := '{}'::jsonb;
begin
 select id into v_id from public.quotes where organization_id=v_org and status='review' order by id limit 1;
 v_before := jsonb_build_object('quote',(select to_jsonb(q) from public.quotes q where id=v_id),'versions',(select jsonb_agg(to_jsonb(qv) order by id) from public.quote_versions qv where quote_id=v_id),'approvals',(select jsonb_agg(to_jsonb(qa) order by qa.id) from public.quote_approvals qa join public.quote_versions qv on qv.id=qa.quote_version_id where qv.quote_id=v_id),'lines',(select jsonb_agg(to_jsonb(ql) order by ql.id) from public.quote_lines ql join public.quote_versions qv on qv.id=ql.quote_version_id where qv.quote_id=v_id));
 begin
  perform public.appdeploy_review_quote_owner_approval(v_actor,v_id,'approve',null);
  raise exception 'Unexpected native quote approval success';
 exception when others then
  if sqlerrm='Unexpected native quote approval success' then raise; end if;
  v_receipt := v_receipt || jsonb_build_object('quoteMissingPendingApprovalDenied',sqlerrm='Pending Owner approval record is missing');
 end;
 begin
  perform public.appdeploy_review_quote_owner_approval(v_actor,v_id,'return','Transient native rollback verification');
  raise exception 'Unexpected native quote return success';
 exception when others then
  if sqlerrm='Unexpected native quote return success' then raise; end if;
  v_receipt := v_receipt || jsonb_build_object('quoteMissingPendingReturnDenied',sqlerrm='Pending Owner approval record is missing');
 end;
 v_after := jsonb_build_object('quote',(select to_jsonb(q) from public.quotes q where id=v_id),'versions',(select jsonb_agg(to_jsonb(qv) order by id) from public.quote_versions qv where quote_id=v_id),'approvals',(select jsonb_agg(to_jsonb(qa) order by qa.id) from public.quote_approvals qa join public.quote_versions qv on qv.id=qa.quote_version_id where qv.quote_id=v_id),'lines',(select jsonb_agg(to_jsonb(ql) order by ql.id) from public.quote_lines ql join public.quote_versions qv on qv.id=ql.quote_version_id where qv.quote_id=v_id));
 if v_before is distinct from v_after then raise exception 'Quote denial left changed records'; end if;
 v_receipt := v_receipt || jsonb_build_object('quoteRecordsUnchanged',true,'quotePositiveVerificationUnavailable','Both real review quotes lack a current-version Pending Owner approval; the sole Draft quote lacks a site. Eligibility was not manufactured.');
 select id into v_id from public.purchase_orders where organization_id=v_org and status='pending_owner_approval' and not paid order by id limit 1;
 if v_id is null then raise exception 'No actual pending purchase request is eligible'; end if;
 v_before:=jsonb_build_object('record',(select to_jsonb(p) from public.purchase_orders p where id=v_id),'audit',(select jsonb_agg(to_jsonb(a) order by id) from public.audit_events a where entity_id=v_id));
 begin
  v_result := public.appdeploy_review_purchase_order(v_actor,v_id,'approve',null);
  select x into v_read from jsonb_array_elements(public.appdeploy_purchasing_snapshot(v_actor,v_org)->'items') x where x->>'id'=v_id::text;
  if not (v_result->>'status'='open_po' and v_read->>'status'='Open PO' and (v_read->>'poApproved')::boolean) then raise exception 'PO approval readback failed'; end if;
  v_receipt := v_receipt || jsonb_build_object('poApprovalNativeResult',true,'poApprovalFreshNativeSnapshot',true);
  raise exception using errcode='ZC001', message='Rollback native verification';
 exception when sqlstate 'ZC001' then null;
 end;
 begin
  v_result := public.appdeploy_review_purchase_order(v_actor,v_id,'return','Transient native rollback verification');
  select x into v_read from jsonb_array_elements(public.appdeploy_purchasing_snapshot(v_actor,v_org)->'items') x where x->>'id'=v_id::text;
  if not (v_result->>'status'='purchase_request_returned' and v_read->>'status'='Purchase Request Returned' and not (v_read->>'poApproved')::boolean and v_read->>'poReturnReason'='Transient native rollback verification') then raise exception 'PO return readback failed'; end if;
  v_receipt := v_receipt || jsonb_build_object('poReturnNativeResult',true,'poReturnFreshNativeSnapshot',true);
  raise exception using errcode='ZC001', message='Rollback native verification';
 exception when sqlstate 'ZC001' then null;
 end;
 v_after:=jsonb_build_object('record',(select to_jsonb(p) from public.purchase_orders p where id=v_id),'audit',(select jsonb_agg(to_jsonb(a) order by id) from public.audit_events a where entity_id=v_id));
 if v_before is distinct from v_after then raise exception 'PO rollback left changed record or audit'; end if;
 v_receipt:=v_receipt||jsonb_build_object('poRecordAndAuditExactlyRestored',true);
 select id into v_id from public.invoices where organization_id=v_org and status='issued' order by id limit 1;
 select to_jsonb(i) into v_before from public.invoices i where id=v_id;
 begin
  perform public.appdeploy_approve_invoice(v_actor,v_id);
  raise exception 'Unexpected native issued invoice approval success';
 exception when others then
  if sqlerrm='Unexpected native issued invoice approval success' then raise; end if;
  v_receipt:=v_receipt||jsonb_build_object('issuedInvoiceApprovalDenied',sqlerrm='Only draft or review invoices can be approved');
 end;
 begin
  perform public.appdeploy_issue_invoice(v_actor,v_id);
  raise exception 'Unexpected native issued invoice replay success';
 exception when others then
  if sqlerrm='Unexpected native issued invoice replay success' then raise; end if;
  v_receipt:=v_receipt||jsonb_build_object('issuedInvoiceReplayDenied',sqlerrm='Invoice must be approved before issue');
 end;
 select to_jsonb(i) into v_after from public.invoices i where id=v_id;
 if v_before is distinct from v_after then raise exception 'Invoice denial left changes'; end if;
 v_receipt:=v_receipt||jsonb_build_object('issuedInvoiceExactlyUnchanged',true,'invoicePositiveVerificationUnavailable','No actual draft/review invoices or uninvoiced Billing Ready jobs exist');
 select id into v_id from public.purchase_orders where organization_id=v_org and match_status='exception' and not paid order by id limit 1;
 select to_jsonb(p) into v_before from public.purchase_orders p where id=v_id;
 begin
  perform public.appdeploy_approve_purchase_for_payment(v_actor,v_id);
  raise exception 'Unexpected native unmatched AP approval success';
 exception when others then
  if sqlerrm='Unexpected native unmatched AP approval success' then raise; end if;
  v_receipt:=v_receipt||jsonb_build_object('unmatchedAPApprovalDenied',sqlerrm='Only a newly matched packet can be approved for payment');
 end;
 begin
  perform public.appdeploy_return_purchase_for_review(v_actor,v_id);
  raise exception 'Unexpected native unmatched AP return success';
 exception when others then
  if sqlerrm='Unexpected native unmatched AP return success' then raise; end if;
  v_receipt:=v_receipt||jsonb_build_object('unmatchedAPReturnDenied',sqlerrm='Only matched AP packets can be returned for review');
 end;
 select to_jsonb(p) into v_after from public.purchase_orders p where id=v_id;
 if v_before is distinct from v_after then raise exception 'AP denial left changes'; end if;
 v_receipt:=v_receipt||jsonb_build_object('unmatchedAPPacketExactlyUnchanged',true,'apPositiveVerificationUnavailable','No actual matched Ready for AP Approval packet exists','mode','Existing production rows only; successful PO decisions and all artifacts rolled back; native invalid-state denials verified');
 if exists(select 1 from jsonb_each(v_receipt) e where e.value='false'::jsonb) then raise exception 'A verification check failed'; end if;
 perform set_config('cos.phase2_finance_verification',v_receipt::text,true);
end $verification$;
select current_setting('cos.phase2_finance_verification')::jsonb as receipt;

do $verification$
declare
 v_actor uuid := '3f073784-96e7-43d8-b9e0-33ab31c3c8b1';
 v_org uuid := 'ece6d2a2-fd19-4cc7-b56a-2fa004a6d8f5';
 v_id uuid; v_before jsonb; v_after jsonb; v_row jsonb; v_payload jsonb; v_read jsonb; v_result jsonb; v_receipt jsonb := '{}'::jsonb;
 v_marker text := 'Native rollback-only persistence verification';
begin
 select id into v_id from public.customers where organization_id=v_org order by id limit 1;
 select to_jsonb(c) into v_row from public.customers c where id=v_id;
 if v_row is null then raise exception 'No actual customer exists'; end if;
 v_before:=jsonb_build_object('record',v_row,'audit',(select jsonb_agg(to_jsonb(a) order by id) from public.audit_events a where entity_id=v_id));
 v_payload:=jsonb_build_object('name',v_row->'name','legalName',v_row->'legal_name','status',v_row->'status','notes',btrim(coalesce(v_row->>'notes','')||' '||v_marker));
 begin
  v_result:=public.appdeploy_save_customer(v_actor,v_org,v_id,v_payload);
  select x into v_read from jsonb_array_elements(public.appdeploy_customers_snapshot(v_actor,v_org)->'items') x where x->>'id'=v_id::text;
  if v_result->>'id'<>v_id::text or v_read->>'notes'<>v_payload->>'notes' or v_read->>'name'<>v_payload->>'name' then raise exception 'Customer native save/readback failed'; end if;
  v_receipt:=v_receipt||jsonb_build_object('customerExistingRowSave',true,'customerFreshNativeSnapshot',true);
  raise exception using errcode='ZC001',message='Rollback native verification';
 exception when sqlstate 'ZC001' then null;
 end;
 v_after:=jsonb_build_object('record',(select to_jsonb(c) from public.customers c where id=v_id),'audit',(select jsonb_agg(to_jsonb(a) order by id) from public.audit_events a where entity_id=v_id));
 if v_before is distinct from v_after then raise exception 'Customer rollback left changes'; end if;
 v_receipt:=v_receipt||jsonb_build_object('customerRowAndAuditExactlyRestored',true);
 select id into v_id from public.sites where organization_id=v_org order by id limit 1;
 select to_jsonb(s) into v_row from public.sites s where id=v_id;
 if v_row is null then raise exception 'No actual site exists'; end if;
 v_before:=jsonb_build_object('record',v_row,'audit',(select jsonb_agg(to_jsonb(a) order by id) from public.audit_events a where entity_id=v_id));
 v_payload:=jsonb_build_object('customerId',v_row->'customer_id','name',v_row->'name','status',v_row->'status','addressLine1',v_row->'address_line1','addressLine2',v_row->'address_line2','city',v_row->'city','stateRegion',v_row->'state_region','postalCode',v_row->'postal_code','country',v_row->'country','accessInstructions',v_row->'access_instructions','parkingInstructions',v_row->'parking_instructions','safetyNotes',v_row->'safety_notes','operationalNotes',btrim(coalesce(v_row->>'operational_notes','')||' '||v_marker));
 begin
  v_result:=public.appdeploy_save_site(v_actor,v_org,v_id,v_payload);
  select x into v_read from jsonb_array_elements(public.appdeploy_sites_snapshot(v_actor,v_org)->'items') x where x->>'id'=v_id::text;
  if v_result->>'id'<>v_id::text or v_read->>'operationalNotes'<>v_payload->>'operationalNotes' or v_read->>'customerId'<>v_payload->>'customerId' then raise exception 'Site native save/readback failed'; end if;
  v_receipt:=v_receipt||jsonb_build_object('siteExistingRowSave',true,'siteFreshNativeSnapshot',true);
  raise exception using errcode='ZC001',message='Rollback native verification';
 exception when sqlstate 'ZC001' then null;
 end;
 v_after:=jsonb_build_object('record',(select to_jsonb(s) from public.sites s where id=v_id),'audit',(select jsonb_agg(to_jsonb(a) order by id) from public.audit_events a where entity_id=v_id));
 if v_before is distinct from v_after then raise exception 'Site rollback left changes'; end if;
 v_receipt:=v_receipt||jsonb_build_object('siteRowAndAuditExactlyRestored',true);
 select u.id into v_id from public.equipment_units u join public.equipment_models m on m.id=u.model_id and m.active where u.organization_id=v_org order by u.id limit 1;
 select to_jsonb(u) into v_row from public.equipment_units u where id=v_id;
 if v_row is null then raise exception 'No actual equipment unit with an active model exists'; end if;
 v_before:=jsonb_build_object('record',v_row,'audit',(select jsonb_agg(to_jsonb(a) order by id) from public.audit_events a where entity_id=v_id),'locations',(select jsonb_agg(to_jsonb(h) order by id) from public.equipment_unit_location_history h where equipment_unit_id=v_id));
 v_payload:=jsonb_build_object('modelId',v_row->'model_id','unitNumber',v_row->'unit_number','status',v_row->'status','currentLocationType',v_row->'current_location_type','serialNumber',btrim(coalesce(v_row->>'serial_number','')||' rollback-verification'));
 begin
  v_result:=public.appdeploy_save_equipment_unit(v_actor,v_org,v_id,v_payload);
  select x into v_read from jsonb_array_elements(public.appdeploy_equipment_registry_snapshot(v_actor,v_org)->'items') x where x->>'id'=v_id::text;
  if v_result->>'id'<>v_id::text or v_read->>'serialNumber'<>v_payload->>'serialNumber' or v_read->>'modelId'<>v_payload->>'modelId' or v_read->>'status'<>v_payload->>'status' then raise exception 'Equipment native save/readback failed'; end if;
  v_receipt:=v_receipt||jsonb_build_object('equipmentExistingRowSave',true,'equipmentFreshNativeSnapshot',true);
  raise exception using errcode='ZC001',message='Rollback native verification';
 exception when sqlstate 'ZC001' then null;
 end;
 v_after:=jsonb_build_object('record',(select to_jsonb(u) from public.equipment_units u where id=v_id),'audit',(select jsonb_agg(to_jsonb(a) order by id) from public.audit_events a where entity_id=v_id),'locations',(select jsonb_agg(to_jsonb(h) order by id) from public.equipment_unit_location_history h where equipment_unit_id=v_id));
 if v_before is distinct from v_after then raise exception 'Equipment rollback left changes'; end if;
 v_receipt:=v_receipt||jsonb_build_object('equipmentRowAuditAndLocationsExactlyRestored',true,'mode','Actual existing rows, native save RPC, independent fresh native snapshot; every changed value and artifact restored by subtransaction rollback. No creates, status changes or installed/assignment changes.');
 perform set_config('cos.phase2_directory_verification',v_receipt::text,true);
end $verification$;
select current_setting('cos.phase2_directory_verification')::jsonb as receipt;

do $verification$
declare
 v_org uuid:='ece6d2a2-fd19-4cc7-b56a-2fa004a6d8f5';
 v_actor uuid; v_department text; v_tasks jsonb; v_day jsonb; v_detail jsonb; v_visit uuid;
 v_expected integer; v_count integer; v_receipt jsonb:='{}'::jsonb; v_counts jsonb:='[]'::jsonb; v_before jsonb; v_after jsonb;
begin
 v_before:=jsonb_build_object('assignments',(select jsonb_agg(to_jsonb(a) order by id) from public.visit_assignments a),'profiles',(select jsonb_agg(to_jsonb(p) order by user_id) from public.user_profiles p),'roles',(select jsonb_agg(to_jsonb(r) order by user_id,role_id) from public.user_roles r));
 foreach v_actor in array array['d0757b64-9623-4adc-afff-21cc7853e88a','3caf7c00-627f-445f-bce4-ddeae574ee5c','7b3b8561-5dc1-46ff-8cdd-129ce2a2afb8','1a7d3523-8a3c-488a-9216-4e37f4f7ecb9']::uuid[] loop
  select department into v_department from public.user_profiles where user_id=v_actor and organization_id=v_org and active;
  if v_department not in ('it','service') then raise exception 'Linked technician department missing'; end if;
  v_day:=public.appdeploy_technician_my_day(v_actor,v_org);
  v_tasks:=public.appdeploy_technician_tasks_snapshot(v_actor,v_org);
  select count(*) into v_expected from public.owner_tasks where organization_id=v_org and (assigned_user_id=v_actor or (assigned_user_id is null and assigned_department=v_department)) and status<>'cancelled';
  if jsonb_array_length(v_tasks->'items')<>v_expected then raise exception 'Native task scope does not match own identity or department'; end if;
  if exists(select 1 from jsonb_array_elements(v_tasks->'items') x where not exists(select 1 from public.owner_tasks t where t.id=(x->>'id')::uuid and t.organization_id=v_org and (t.assigned_user_id=v_actor or (t.assigned_user_id is null and t.assigned_department=v_department)))) then raise exception 'Native tasks include another technician private task'; end if;
  select count(*) into v_count from public.visit_assignments a join public.job_visits v on v.id=a.visit_id where a.user_id=v_actor and a.assignment_role='technician' and a.status in ('assigned','accepted') and v.organization_id=v_org and v.status not in ('completed','cancelled');
  v_counts:=v_counts||jsonb_build_array(jsonb_build_object('department',v_department,'activeOwnAssignedVisits',v_count,'myDayVisitCount',jsonb_array_length(coalesce(v_day->'visits','[]'::jsonb)),'nativeTaskCount',v_expected));
 end loop;
 v_actor:='d0757b64-9623-4adc-afff-21cc7853e88a';
 select we.visit_id into v_visit from public.workflow_executions we join public.job_visits v on v.id=we.visit_id join public.visit_assignments a on a.visit_id=v.id where we.assigned_user_id=v_actor and a.user_id=v_actor and a.assignment_role='technician' and a.status in ('assigned','accepted') and v.organization_id=v_org and v.status not in ('completed','cancelled') order by we.id limit 1;
 if v_visit is null then raise exception 'No actual own assigned workflow exists to verify'; end if;
 v_detail:=public.appdeploy_technician_visit_snapshot(v_actor,v_org,v_visit);
 if v_detail#>>'{visit,id}'<>v_visit::text or not exists(select 1 from public.workflow_executions we where we.id=(v_detail#>>'{execution,id}')::uuid and we.assigned_user_id=v_actor) then raise exception 'Native own visit detail verification failed'; end if;
 v_receipt:=v_receipt||jsonb_build_object('ownAssignedWorkflowReadable',true);
 select we.visit_id into v_visit from public.workflow_executions we join public.job_visits v on v.id=we.visit_id where we.assigned_user_id<>v_actor and v.organization_id=v_org order by we.id limit 1;
 if v_visit is null then raise exception 'No actual other-technician workflow exists to verify'; end if;
 v_detail:=public.appdeploy_technician_visit_snapshot(v_actor,v_org,v_visit);
 if v_detail<>'{}'::jsonb then raise exception 'Native other-technician workflow data was returned'; end if;
 v_receipt:=v_receipt||jsonb_build_object('otherTechnicianNativeDetailEmpty',true,'allFourTechnicianNativeReadsPassed',true,'nativeTasksOwnIdentityOrDepartmentOnly',true,'queueCounts',v_counts);
 v_after:=jsonb_build_object('assignments',(select jsonb_agg(to_jsonb(a) order by id) from public.visit_assignments a),'profiles',(select jsonb_agg(to_jsonb(p) order by user_id) from public.user_profiles p),'roles',(select jsonb_agg(to_jsonb(r) order by user_id,role_id) from public.user_roles r));
 if v_before is distinct from v_after then raise exception 'Read-only queue verification changed identities, roles, or assignments'; end if;
 v_receipt:=v_receipt||jsonb_build_object('profilesRolesAndAssignmentsExactlyUnchanged',true,'mode','Native service RPC actor argument on four real existing technicians; no user tokens minted or borrowed; aggregate receipt only. Bridge bearer authentication verified separately by injected-transport tests.');
 perform set_config('cos.phase2_queue_verification',v_receipt::text,true);
end $verification$;
select current_setting('cos.phase2_queue_verification')::jsonb as receipt;
