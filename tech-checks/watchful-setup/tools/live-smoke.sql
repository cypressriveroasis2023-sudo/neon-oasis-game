-- Watchful setup check: live smoke test on Tech Check (goqrnolcvqnirjmzaeyk).
-- Runs the whole job against the real rules and real camera records, as the two test accounts
-- ("Test Service" does the tech steps, "Test IT" the office check) on SOLARSPOTTER 058 (the test unit),
-- then ROLLS BACK: nothing is kept, not even audit rows or photo records. Safe to run any time.
-- Run it as one batch (e.g. Supabase SQL / MCP execute_sql). The last select shows PASS/FAIL per step.
begin;
create temp table _smoke (n serial, step text, ok boolean, detail text) on commit drop;
grant all on _smoke, _smoke_n_seq to authenticated;

do $smoke$
declare
  svc constant text := 'b9465a4e-c003-4205-8154-56792c9cfed9';   -- Test Service
  itx constant text := '05bf20fe-19f7-4db7-ac05-5b2a5f681fdf';   -- Test IT
  u jsonb; opt jsonb; chk jsonb; cams jsonb := '[]'; it jsonb; c jsonb; pick jsonb; i int; p text; n_items int;
begin
  -- helpers inline: act as a user; make a photo path the storage policy must accept
  perform set_config('request.jwt.claims', json_build_object('sub', svc, 'role', 'authenticated')::text, true);
  execute 'set local role authenticated';

  u := (public.ws_find_units_v1('solarspotter 058'))->0;
  insert into _smoke(step, ok, detail) values ('find SS058 with models from COS', u->>'key' = 'SOLARSPOTTER 058' and jsonb_array_length(u->'cameras') = 4,
    (u->>'label') || ' / ' || (u->>'suggestedType') || ' / cams ' || jsonb_array_length(u->'cameras'));
  opt := public.ws_options_v1('Solar Spotter (SS)');

  chk := public.ws_start_v1(u->>'key', u->>'label', 'Shop (smoke test)', 'Solar Spotter (SS)', 'recommission');
  insert into _smoke(step, ok, detail) values ('start a check', chk->>'status' = 'draft', chk->>'id');

  -- every camera's model straight from COS, as the screen prefills it
  for i in 0 .. jsonb_array_length(u->'cameras') - 1 loop
    c := u->'cameras'->i;
    select m into pick from jsonb_array_elements(opt->'choices'->'standalone') m where m->>'model' = c->>'model';
    cams := cams || jsonb_build_array(jsonb_build_object('position', i + 1, 'role', 'camera_standalone',
      'model_id', pick->>'id', 'name', c->>'name'));
  end loop;
  chk := public.ws_save_selection_v1((chk->>'id')::uuid, true, null, null, null, null, cams);
  select count(*) into n_items from jsonb_array_elements(chk->'sections') s, jsonb_array_elements(s->'items') x;
  insert into _smoke(step, ok, detail) values ('checklist built for ALI-PB50-LUAIS x4', n_items > 0 and chk->>'status' = 'in_progress', n_items || ' steps');

  -- do every step; a photo wherever one is required (uploaded under the tech's own folder, through the storage policy)
  for it in select x from jsonb_array_elements(chk->'sections') s, jsonb_array_elements(s->'items') x loop
    continue when it->>'standardStatus' = 'PLACEHOLDER';
    chk := public.ws_set_item_v1((it->>'id')::uuid, 'done', it->'options'->>0, null, 'smoke test');
    if it->>'evidence' = 'required' then
      p := svc || '/' || (chk->>'id') || '/' || encode(sha256(convert_to(it->>'id', 'UTF8')), 'hex') || '.jpg';
      insert into storage.objects(bucket_id, name, metadata) values ('techcheck-watchful-setup', p, '{"size": 52000}');
      chk := public.ws_add_photo_v1((it->>'id')::uuid, p);
    end if;
  end loop;
  insert into _smoke(step, ok, detail) values ('all steps done, only the walk test left',
    (select bool_and(b::text ~* 'walk test') from jsonb_array_elements_text(chk->'blockers') b), jsonb_array_length(chk->'blockers') || ' left');

  -- walk test
  p := svc || '/' || (chk->>'id') || '/' || encode(sha256(convert_to('tm-on', 'UTF8')), 'hex') || '.jpg';
  insert into storage.objects(bucket_id, name, metadata) values ('techcheck-watchful-setup', p, '{"size": 52000}');
  chk := public.ws_test_mode_v1((chk->>'id')::uuid, true, p);
  for c in select x from jsonb_array_elements(chk->'selection'->'cameras') x loop
    p := svc || '/' || (chk->>'id') || '/' || encode(sha256(convert_to('walk' || (c->>'id'), 'UTF8')), 'hex') || '.jpg';
    insert into storage.objects(bucket_id, name, metadata) values ('techcheck-watchful-setup', p, '{"size": 52000}');
    chk := public.ws_walk_v1((c->>'id')::uuid, true, now(), p);
  end loop;
  p := svc || '/' || (chk->>'id') || '/' || encode(sha256(convert_to('tm-off', 'UTF8')), 'hex') || '.jpg';
  insert into storage.objects(bucket_id, name, metadata) values ('techcheck-watchful-setup', p, '{"size": 52000}');
  chk := public.ws_test_mode_v1((chk->>'id')::uuid, false, p);
  insert into _smoke(step, ok, detail) values ('every camera walk-tested', jsonb_array_length(chk->'blockers') = 0, chk->>'blockers');

  chk := public.ws_submit_v1((chk->>'id')::uuid);
  insert into _smoke(step, ok, detail) values ('Test Service sends it to the office', chk->>'status' = 'awaiting_office', chk->>'techSignedBy');

  -- the office: Test IT
  perform set_config('request.jwt.claims', json_build_object('sub', itx, 'role', 'authenticated')::text, true);
  p := itx || '/' || (chk->>'id') || '/' || encode(sha256(convert_to('count', 'UTF8')), 'hex') || '.jpg';
  insert into storage.objects(bucket_id, name, metadata) values ('techcheck-watchful-setup', p, '{"size": 52000}');
  begin
    perform public.ws_sign_off_v1((chk->>'id')::uuid, 3, 4, p, null);
    insert into _smoke(step, ok, detail) values ('a wrong Watchful count is refused', false, 'was accepted');
  exception when others then insert into _smoke(step, ok, detail) values ('a wrong Watchful count is refused', sqlerrm ~ 'Counts do not match', sqlerrm);
  end;
  chk := public.ws_sign_off_v1((chk->>'id')::uuid, 4, 4, p, null);
  insert into _smoke(step, ok, detail) values ('Test IT signs off 4 of 4: live', chk->>'status' = 'live', chk->>'officeSignedBy');

  -- the quiet list now watches SS058's cameras (Unknown until a Watchful list is imported)
  insert into _smoke(step, ok, detail) select 'SS058 cameras watched, Unknown until a reading',
    count(*) = 4 and bool_and(x->>'status' = 'unknown'), count(*) || ' cameras'
  from jsonb_array_elements(public.ws_quiet_v1()->'cameras') x where x->>'unitKey' = 'SOLARSPOTTER 058';

  -- Service may not see the quiet list
  perform set_config('request.jwt.claims', json_build_object('sub', svc, 'role', 'authenticated')::text, true);
  begin
    perform public.ws_quiet_v1();
    insert into _smoke(step, ok, detail) values ('Service cannot open Quiet cameras', false, 'was allowed');
  exception when others then insert into _smoke(step, ok, detail) values ('Service cannot open Quiet cameras', true, sqlerrm);
  end;
exception when others then
  insert into _smoke(step, ok, detail) values ('stopped with an error', false, sqlerrm);
end $smoke$;

reset role;
select n, case when ok then 'PASS' else 'FAIL' end result, step, detail from _smoke order by n;
rollback;
