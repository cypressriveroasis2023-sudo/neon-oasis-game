-- The complete 1,001-product Owner review exceeds PostgREST's inherited 8s.
-- Bound only these guarded import calls; keep role/global and lock limits intact.
alter function public.cos_owner_mhelp_equipment_stage_v1(uuid,uuid,uuid,text,text,text,text,jsonb,text,jsonb)
  set statement_timeout to '60s';
alter function public.cos_owner_mhelp_equipment_commit_v1(uuid,uuid,uuid,text,text,text)
  set statement_timeout to '60s';
notify pgrst, 'reload schema';
