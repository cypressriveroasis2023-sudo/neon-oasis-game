-- OnSite Vision Phase 5: persistent conversations + managed company knowledge
-- Conversations are Owner-private. Knowledge is Owner-managed and only APPROVED entries
-- are eligible for AI grounding.

create table if not exists public.vision_conversations (
  id text primary key,
  owner_user_id uuid not null references auth.users(id) on delete cascade,
  title text not null default 'New conversation',
  active_ticket text,
  draft jsonb,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  archived_at timestamptz
);

create index if not exists vision_conversations_owner_updated_idx
  on public.vision_conversations(owner_user_id, updated_at desc);

create table if not exists public.vision_messages (
  id text primary key,
  conversation_id text not null references public.vision_conversations(id) on delete cascade,
  owner_user_id uuid not null references auth.users(id) on delete cascade,
  role text not null check (role in ('user','assistant','system')),
  text_content text not null default '',
  html_content text not null default '',
  created_at timestamptz not null default now()
);

create index if not exists vision_messages_conversation_idx
  on public.vision_messages(conversation_id, created_at, id);

create table if not exists public.vision_knowledge_entries (
  id uuid primary key default gen_random_uuid(),
  title text not null,
  domain text not null default 'technical'
    check (domain in ('technical','product','workflow','sop','troubleshooting','configuration','safety','operations')),
  equipment_type text,
  workflow_type text,
  topic text,
  content text not null,
  status text not null default 'draft'
    check (status in ('draft','approved','retired')),
  source_kind text not null default 'owner'
    check (source_kind in ('owner','code_baseline','database_rule','sop','vendor','other')),
  source_ref text,
  tags text[] not null default '{}'::text[],
  version integer not null default 1 check (version >= 1),
  created_by uuid not null references auth.users(id) on delete restrict,
  created_by_name text not null,
  reviewed_by uuid references auth.users(id) on delete restrict,
  reviewed_by_name text,
  reviewed_at timestamptz,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

create index if not exists vision_knowledge_status_idx
  on public.vision_knowledge_entries(status, updated_at desc);
create index if not exists vision_knowledge_equipment_idx
  on public.vision_knowledge_entries(equipment_type, status, updated_at desc);
create index if not exists vision_knowledge_workflow_idx
  on public.vision_knowledge_entries(workflow_type, status, updated_at desc);
create index if not exists vision_knowledge_search_idx
  on public.vision_knowledge_entries using gin (
    to_tsvector('english',
      coalesce(title,'') || ' ' ||
      coalesce(topic,'') || ' ' ||
      coalesce(equipment_type,'') || ' ' ||
      coalesce(workflow_type,'') || ' ' ||
      coalesce(content,'')
    )
  );

create table if not exists public.vision_knowledge_versions (
  id uuid primary key default gen_random_uuid(),
  entry_id uuid not null references public.vision_knowledge_entries(id) on delete cascade,
  version integer not null,
  snapshot jsonb not null,
  changed_by uuid not null references auth.users(id) on delete restrict,
  changed_by_name text not null,
  created_at timestamptz not null default now(),
  unique(entry_id,version)
);

alter table public.vision_conversations enable row level security;
alter table public.vision_messages enable row level security;
alter table public.vision_knowledge_entries enable row level security;
alter table public.vision_knowledge_versions enable row level security;

drop policy if exists vision_conversations_owner_read on public.vision_conversations;
create policy vision_conversations_owner_read
on public.vision_conversations
for select to authenticated
using (
  owner_user_id=auth.uid()
  and public.current_app_role()='owner'::public.app_role
);

drop policy if exists vision_messages_owner_read on public.vision_messages;
create policy vision_messages_owner_read
on public.vision_messages
for select to authenticated
using (
  owner_user_id=auth.uid()
  and public.current_app_role()='owner'::public.app_role
);

drop policy if exists vision_knowledge_owner_read on public.vision_knowledge_entries;
create policy vision_knowledge_owner_read
on public.vision_knowledge_entries
for select to authenticated
using (public.current_app_role()='owner'::public.app_role);

drop policy if exists vision_knowledge_versions_owner_read on public.vision_knowledge_versions;
create policy vision_knowledge_versions_owner_read
on public.vision_knowledge_versions
for select to authenticated
using (public.current_app_role()='owner'::public.app_role);

revoke all privileges on table public.vision_conversations from authenticated, anon;
revoke all privileges on table public.vision_messages from authenticated, anon;
revoke all privileges on table public.vision_knowledge_entries from authenticated, anon;
revoke all privileges on table public.vision_knowledge_versions from authenticated, anon;
grant select on table public.vision_conversations to authenticated;
grant select on table public.vision_messages to authenticated;
grant select on table public.vision_knowledge_entries to authenticated;
grant select on table public.vision_knowledge_versions to authenticated;

create or replace function public.vision_save_conversation_v1(
  p_conversation_id text,
  p_title text,
  p_active_ticket text,
  p_draft jsonb,
  p_messages jsonb
)
returns jsonb
language plpgsql
security definer
set search_path=public, pg_temp
as $$
declare
  v_actor uuid:=auth.uid();
  v_now timestamptz:=now();
  v_msg jsonb;
  v_msg_id text;
  v_role text;
  v_at timestamptz;
begin
  perform public.require_role(array['owner'::public.app_role]);

  if nullif(trim(coalesce(p_conversation_id,'')),'') is null then
    raise exception 'Conversation id is required.';
  end if;
  if jsonb_typeof(coalesce(p_messages,'[]'::jsonb))<>'array' then
    raise exception 'Conversation messages must be an array.';
  end if;

  insert into public.vision_conversations(
    id,owner_user_id,title,active_ticket,draft,created_at,updated_at,archived_at
  )
  values(
    trim(p_conversation_id),v_actor,
    coalesce(nullif(trim(p_title),''),'New conversation'),
    nullif(trim(coalesce(p_active_ticket,'')),''),
    p_draft,
    coalesce(
      case when p_messages->0->>'at' is not null then (p_messages->0->>'at')::timestamptz else null end,
      v_now
    ),
    v_now,null
  )
  on conflict(id) do update
  set title=excluded.title,
      active_ticket=excluded.active_ticket,
      draft=excluded.draft,
      updated_at=v_now,
      archived_at=null
  where vision_conversations.owner_user_id=v_actor;

  if not found then
    raise exception 'Conversation belongs to another user or cannot be updated.';
  end if;

  for v_msg in select value from jsonb_array_elements(coalesce(p_messages,'[]'::jsonb))
  loop
    v_role:=lower(trim(coalesce(v_msg->>'role','')));
    if v_role not in ('user','assistant','system') then
      continue;
    end if;

    v_msg_id:=coalesce(
      nullif(trim(v_msg->>'id'),''),
      md5(trim(p_conversation_id)||'|'||coalesce(v_msg->>'at','')||'|'||v_role||'|'||coalesce(v_msg->>'text','')||'|'||coalesce(v_msg->>'html',''))
    );

    begin
      v_at:=coalesce(nullif(v_msg->>'at','')::timestamptz,v_now);
    exception when others then
      v_at:=v_now;
    end;

    insert into public.vision_messages(
      id,conversation_id,owner_user_id,role,text_content,html_content,created_at
    )
    values(
      v_msg_id,trim(p_conversation_id),v_actor,v_role,
      coalesce(v_msg->>'text',''),coalesce(v_msg->>'html',''),v_at
    )
    on conflict(id) do update
    set text_content=excluded.text_content,
        html_content=excluded.html_content
    where vision_messages.owner_user_id=v_actor
      and vision_messages.conversation_id=trim(p_conversation_id);
  end loop;

  return jsonb_build_object(
    'conversation_id',trim(p_conversation_id),
    'saved',true,
    'updated_at',v_now
  );
end;
$$;

revoke all on function public.vision_save_conversation_v1(text,text,text,jsonb,jsonb) from public,anon;
grant execute on function public.vision_save_conversation_v1(text,text,text,jsonb,jsonb) to authenticated;

create or replace function public.vision_load_conversations_v1(p_limit integer default 20)
returns jsonb
language sql
stable
security definer
set search_path=public, pg_temp
as $$
  select coalesce(jsonb_agg(row_data order by (row_data->>'updatedAt')::timestamptz desc),'[]'::jsonb)
  from (
    select jsonb_build_object(
      'id',c.id,
      'title',c.title,
      'createdAt',c.created_at,
      'updatedAt',c.updated_at,
      'ticket',coalesce(c.active_ticket,''),
      'draft',c.draft,
      'messages',coalesce((
        select jsonb_agg(jsonb_build_object(
          'id',m.id,
          'role',m.role,
          'text',m.text_content,
          'html',m.html_content,
          'at',m.created_at
        ) order by m.created_at,m.id)
        from public.vision_messages m
        where m.conversation_id=c.id
          and m.owner_user_id=auth.uid()
      ),'[]'::jsonb)
    ) as row_data
    from public.vision_conversations c
    where c.owner_user_id=auth.uid()
      and c.archived_at is null
      and public.current_app_role()='owner'::public.app_role
    order by c.updated_at desc
    limit greatest(1,least(coalesce(p_limit,20),50))
  ) x;
$$;

revoke all on function public.vision_load_conversations_v1(integer) from public,anon;
grant execute on function public.vision_load_conversations_v1(integer) to authenticated;

create or replace function public.vision_archive_conversation_v1(p_conversation_id text)
returns void
language plpgsql
security definer
set search_path=public, pg_temp
as $$
begin
  perform public.require_role(array['owner'::public.app_role]);
  update public.vision_conversations
  set archived_at=now(),updated_at=now()
  where id=trim(p_conversation_id) and owner_user_id=auth.uid();
end;
$$;

revoke all on function public.vision_archive_conversation_v1(text) from public,anon;
grant execute on function public.vision_archive_conversation_v1(text) to authenticated;

create or replace function public.vision_save_knowledge_entry_v1(
  p_entry_id uuid,
  p_entry jsonb
)
returns jsonb
language plpgsql
security definer
set search_path=public, pg_temp
as $$
declare
  v_actor uuid:=auth.uid();
  v_actor_name text;
  v_id uuid:=p_entry_id;
  v_existing public.vision_knowledge_entries%rowtype;
  v_title text:=trim(coalesce(p_entry->>'title',''));
  v_domain text:=lower(trim(coalesce(p_entry->>'domain','technical')));
  v_equipment text:=nullif(trim(coalesce(p_entry->>'equipment_type','')),'');
  v_workflow text:=nullif(lower(trim(coalesce(p_entry->>'workflow_type',''))),'');
  v_topic text:=nullif(trim(coalesce(p_entry->>'topic','')),'');
  v_content text:=trim(coalesce(p_entry->>'content',''));
  v_status text:=lower(trim(coalesce(p_entry->>'status','draft')));
  v_source_kind text:=lower(trim(coalesce(p_entry->>'source_kind','owner')));
  v_source_ref text:=nullif(trim(coalesce(p_entry->>'source_ref','')),'');
  v_tags text[]:='{}'::text[];
  v_version integer:=1;
begin
  perform public.require_role(array['owner'::public.app_role]);
  v_actor_name:=public.actor_display_name();

  if v_title='' then raise exception 'Knowledge title is required.'; end if;
  if v_content='' then raise exception 'Knowledge content is required.'; end if;
  if v_domain not in ('technical','product','workflow','sop','troubleshooting','configuration','safety','operations') then
    raise exception 'Invalid knowledge domain.';
  end if;
  if v_status not in ('draft','approved','retired') then raise exception 'Invalid knowledge status.'; end if;
  if v_source_kind not in ('owner','code_baseline','database_rule','sop','vendor','other') then
    raise exception 'Invalid knowledge source type.';
  end if;

  if jsonb_typeof(p_entry->'tags')='array' then
    select coalesce(array_agg(distinct trim(value)) filter(where trim(value)<>''),'{}'::text[])
    into v_tags
    from jsonb_array_elements_text(p_entry->'tags');
  end if;

  if v_id is null then
    insert into public.vision_knowledge_entries(
      title,domain,equipment_type,workflow_type,topic,content,status,source_kind,source_ref,tags,
      version,created_by,created_by_name,reviewed_by,reviewed_by_name,reviewed_at
    )
    values(
      v_title,v_domain,v_equipment,v_workflow,v_topic,v_content,v_status,v_source_kind,v_source_ref,v_tags,
      1,v_actor,v_actor_name,
      case when v_status='approved' then v_actor else null end,
      case when v_status='approved' then v_actor_name else null end,
      case when v_status='approved' then now() else null end
    )
    returning id,version into v_id,v_version;
  else
    select * into v_existing
    from public.vision_knowledge_entries
    where id=v_id
    for update;

    if not found then raise exception 'Knowledge entry not found.'; end if;

    insert into public.vision_knowledge_versions(entry_id,version,snapshot,changed_by,changed_by_name)
    values(v_existing.id,v_existing.version,to_jsonb(v_existing),v_actor,v_actor_name)
    on conflict(entry_id,version) do nothing;

    v_version:=v_existing.version+1;

    update public.vision_knowledge_entries
    set title=v_title,
        domain=v_domain,
        equipment_type=v_equipment,
        workflow_type=v_workflow,
        topic=v_topic,
        content=v_content,
        status=v_status,
        source_kind=v_source_kind,
        source_ref=v_source_ref,
        tags=v_tags,
        version=v_version,
        reviewed_by=case when v_status='approved' then v_actor else reviewed_by end,
        reviewed_by_name=case when v_status='approved' then v_actor_name else reviewed_by_name end,
        reviewed_at=case when v_status='approved' then now() else reviewed_at end,
        updated_at=now()
    where id=v_id;
  end if;

  return (
    select jsonb_build_object(
      'id',id,'title',title,'domain',domain,'equipment_type',equipment_type,
      'workflow_type',workflow_type,'topic',topic,'content',content,'status',status,
      'source_kind',source_kind,'source_ref',source_ref,'tags',tags,'version',version,
      'created_by_name',created_by_name,'reviewed_by_name',reviewed_by_name,
      'reviewed_at',reviewed_at,'created_at',created_at,'updated_at',updated_at
    )
    from public.vision_knowledge_entries
    where id=v_id
  );
end;
$$;

revoke all on function public.vision_save_knowledge_entry_v1(uuid,jsonb) from public,anon;
grant execute on function public.vision_save_knowledge_entry_v1(uuid,jsonb) to authenticated;

create or replace function public.vision_list_knowledge_v1(
  p_status text default null,
  p_limit integer default 100
)
returns jsonb
language sql
stable
security definer
set search_path=public, pg_temp
as $$
  select coalesce(jsonb_agg(to_jsonb(k) order by k.updated_at desc),'[]'::jsonb)
  from (
    select
      id,title,domain,equipment_type,workflow_type,topic,content,status,
      source_kind,source_ref,tags,version,created_by_name,reviewed_by_name,
      reviewed_at,created_at,updated_at
    from public.vision_knowledge_entries
    where public.current_app_role()='owner'::public.app_role
      and (
        nullif(lower(trim(coalesce(p_status,''))),'') is null
        or status=lower(trim(p_status))
      )
    order by updated_at desc
    limit greatest(1,least(coalesce(p_limit,100),250))
  ) k;
$$;

revoke all on function public.vision_list_knowledge_v1(text,integer) from public,anon;
grant execute on function public.vision_list_knowledge_v1(text,integer) to authenticated;

create or replace function public.vision_search_knowledge_v1(
  p_query text,
  p_equipment_type text default null,
  p_workflow_type text default null,
  p_limit integer default 12
)
returns jsonb
language sql
stable
security definer
set search_path=public, pg_temp
as $$
  with q as (
    select
      nullif(trim(coalesce(p_query,'')),'') as query,
      nullif(lower(trim(coalesce(p_equipment_type,''))),'') as equipment,
      nullif(lower(trim(coalesce(p_workflow_type,''))),'') as workflow
  ),
  ranked as (
    select
      k.id,k.title,k.domain,k.equipment_type,k.workflow_type,k.topic,k.content,
      k.source_kind,k.source_ref,k.tags,k.version,k.reviewed_by_name,k.reviewed_at,k.updated_at,
      case
        when q.query is null then 0::real
        else ts_rank_cd(
          to_tsvector('english',
            coalesce(k.title,'') || ' ' || coalesce(k.topic,'') || ' ' ||
            coalesce(k.equipment_type,'') || ' ' || coalesce(k.workflow_type,'') || ' ' ||
            coalesce(k.content,'')
          ),
          websearch_to_tsquery('english',q.query)
        )
      end as rank
    from public.vision_knowledge_entries k
    cross join q
    where k.status='approved'
      and public.current_app_role()='owner'::public.app_role
      and (q.equipment is null or lower(coalesce(k.equipment_type,''))=q.equipment)
      and (q.workflow is null or lower(coalesce(k.workflow_type,''))=q.workflow)
      and (
        q.query is null
        or to_tsvector('english',
          coalesce(k.title,'') || ' ' || coalesce(k.topic,'') || ' ' ||
          coalesce(k.equipment_type,'') || ' ' || coalesce(k.workflow_type,'') || ' ' ||
          coalesce(k.content,'')
        ) @@ websearch_to_tsquery('english',q.query)
        or lower(k.title) like '%'||lower(q.query)||'%'
        or lower(coalesce(k.topic,'')) like '%'||lower(q.query)||'%'
        or lower(k.content) like '%'||lower(q.query)||'%'
      )
  )
  select coalesce(jsonb_agg(jsonb_build_object(
    'id',id,'title',title,'domain',domain,'equipment_type',equipment_type,
    'workflow_type',workflow_type,'topic',topic,'content',content,
    'source_kind',source_kind,'source_ref',source_ref,'tags',tags,'version',version,
    'reviewed_by_name',reviewed_by_name,'reviewed_at',reviewed_at,
    'certainty','COMPANY RULE','rank',rank
  ) order by rank desc,updated_at desc),'[]'::jsonb)
  from (
    select * from ranked
    order by rank desc,updated_at desc
    limit greatest(1,least(coalesce(p_limit,12),30))
  ) z;
$$;

revoke all on function public.vision_search_knowledge_v1(text,text,text,integer) from public,anon;
grant execute on function public.vision_search_knowledge_v1(text,text,text,integer) to authenticated;

comment on table public.vision_conversations is
  'Owner-private persistent OnSite Vision conversations. Operational Tech Check records remain separate.';
comment on table public.vision_knowledge_entries is
  'Owner-managed Cameras On Site knowledge. Only approved entries may be used as company-rule grounding by Vision.';
comment on table public.vision_knowledge_versions is
  'Version history for owner-managed OnSite Vision company knowledge.';
