create or replace function public.owner_review_queue_v1(p_limit integer default 40)
returns jsonb
language plpgsql
stable
set search_path to 'public', 'pg_temp'
as $function$
declare
  v_limit integer:=greatest(1,least(coalesce(p_limit,40),100));
  v_row record;
  v_summary jsonb;
  v_rows jsonb:='[]'::jsonb;
begin
  perform public.require_role(array['owner'::public.app_role]);

  for v_row in
    select x.ticket_no,x.latest_complete
    from (
      select
        j.ticket_no,
        max(j.completed_at) filter(where j.assigned_role='service' and j.status='completed') latest_complete
      from public.job_assignments j
      group by j.ticket_no
      having count(*) filter(where j.assigned_role='service' and j.status='completed')>0
    ) x
    order by x.latest_complete desc nulls last
  loop
    v_summary:=public.owner_job_closeout_summary_v1(v_row.ticket_no);
    if coalesce((v_summary->>'ready_for_owner_review')::boolean,false)
       or coalesce(v_summary->>'review_status','')='correction_requested' then
      v_rows:=v_rows||jsonb_build_array(v_summary);
      exit when jsonb_array_length(v_rows)>=v_limit;
    end if;
  end loop;

  return v_rows;
end;
$function$;
