-- Index-only release: avoid detoasting every retained API receipt when selecting
-- the latest earlier CSV. The deployed reader and all validation remain unchanged.
-- Captured 2026-10-27; the exact source/catalog guards reject drift.
-- NOT NULL is checked through columns; PG18's duplicate named NOT NULL catalog
-- representation is omitted from the remaining constraint inventory.
-- No data edits, grants, function replacement, ANALYZE, or timeout increase.
begin;
set local lock_timeout='2s';
set local search_path=pg_catalog,pg_temp;
do $migration$
declare
  expected_function constant jsonb := $expected_function${"source_sha256":"3111c117314dda326c3fe4813f72596bbda92df3d4e0a759c5c3ff380e094624","owner":"postgres","security_definer":false,"volatility":"s","settings":["search_path=\"\""],"acl":"{postgres=X/postgres}"}$expected_function$::jsonb;
  expected_schema constant jsonb := $expected_schema${"acl":"{postgres=arwdDxtm/postgres}","rls":true,"kind":"r","owner":"postgres","columns":[{"name":"source_sha256","type":"text","default":null,"notNull":true,"collation":"\"default\""},{"name":"payload_sha256","type":"text","default":null,"notNull":true,"collation":"\"default\""},{"name":"receipt","type":"jsonb","default":null,"notNull":true,"collation":"-"},{"name":"records","type":"jsonb","default":null,"notNull":true,"collation":"-"},{"name":"admitted_at","type":"timestamp with time zone","default":"clock_timestamp()","notNull":true,"collation":"-"}],"indexes":[{"live":true,"name":"cos_mhelp_placement_private.upload_batches_pkey","ready":true,"valid":true,"definition":"CREATE UNIQUE INDEX upload_batches_pkey ON cos_mhelp_placement_private.upload_batches USING btree (source_sha256)"}],"forceRls":false,"inherits":0,"relation":"cos_mhelp_placement_private.upload_batches","constraints":[{"name":"upload_batches_payload_sha256_check","validated":true,"definition":"CHECK ((payload_sha256 ~ '^[a-f0-9]{64}$'::text))"},{"name":"upload_batches_pkey","validated":true,"definition":"PRIMARY KEY (source_sha256)"},{"name":"upload_batches_source_sha256_check","validated":true,"definition":"CHECK ((source_sha256 ~ '^[a-f0-9]{64}$'::text))"}]}$expected_schema$::jsonb;
  expected_index constant jsonb := $expected_index${"definition":"CREATE INDEX cos_mhelp_upload_batches_prior_csv_idx ON cos_mhelp_placement_private.upload_batches USING btree (admitted_at DESC, source_sha256 DESC) WHERE ((receipt ->> 'contract'::text) = 'COS_MHELP_UPLOAD_V1'::text)","owner":"postgres","kind":"i","table":"cos_mhelp_placement_private.upload_batches","method":"btree","valid":true,"ready":true,"live":true,"unique":false,"primary":false,"exclusion":false,"immediate":true,"keyCount":2,"attributeCount":2,"clustered":false,"replicaIdentity":false,"nullsNotDistinct":false,"tablespace":0,"options":null}$expected_index$::jsonb;
  actual_function jsonb; actual_schema jsonb; actual_index jsonb;
  before_security jsonb; after_security jsonb; index_oid oid;
begin
  if not pg_try_advisory_xact_lock(hashtextextended('COS_MHELP_PRIOR_CSV_INDEX_V1',0)) then
    raise exception 'Prior CSV index maintenance is already running' using errcode='55P03';
  end if;
  if to_regclass('cos_mhelp_placement_private.upload_batches') is null then
    raise exception 'Prior CSV index precondition: source relation is missing' using errcode='55000';
  end if;
  -- CREATE INDEX itself requires SHARE; take the same bounded lock before checking
  -- the source catalog so its shape cannot change between the guard and DDL.
  lock table cos_mhelp_placement_private.upload_batches in share mode;
  select jsonb_build_object(
    'source_sha256',encode(sha256(convert_to(pg_get_functiondef(p.oid),'UTF8')),'hex'),
    'owner',pg_get_userbyid(p.proowner),'security_definer',p.prosecdef,
    'volatility',p.provolatile,'settings',p.proconfig,'acl',p.proacl::text)
  from pg_proc p where p.oid=to_regprocedure('cos_mhelp_placement_private.shop_address_baseline(text)') into actual_function;
  select jsonb_build_object(
    'relation',c.oid::regclass::text,'kind',c.relkind,'owner',pg_get_userbyid(c.relowner),
    'acl',c.relacl::text,'rls',c.relrowsecurity,'forceRls',c.relforcerowsecurity,
    'columns',(select jsonb_agg(jsonb_build_object('name',a.attname,
      'type',format_type(a.atttypid,a.atttypmod),'notNull',a.attnotnull,
      'default',pg_get_expr(d.adbin,d.adrelid),'collation',a.attcollation::regcollation::text) order by a.attnum)
      from pg_attribute a left join pg_attrdef d on d.adrelid=a.attrelid and d.adnum=a.attnum
      where a.attrelid=c.oid and a.attnum>0 and not a.attisdropped),
    'constraints',(select jsonb_agg(jsonb_build_object('name',k.conname,
      'definition',pg_get_constraintdef(k.oid),'validated',k.convalidated) order by k.conname)
      from pg_constraint k where k.conrelid=c.oid and k.contype<>'n'),
    'indexes',(select jsonb_agg(jsonb_build_object('name',i.indexrelid::regclass::text,
      'definition',pg_get_indexdef(i.indexrelid),'valid',i.indisvalid,'ready',i.indisready,'live',i.indislive)
      order by i.indexrelid::regclass::text) from pg_index i where i.indrelid=c.oid
      and i.indexrelid is distinct from to_regclass('cos_mhelp_placement_private.cos_mhelp_upload_batches_prior_csv_idx')),
    'inherits',(select count(*) from pg_inherits h where h.inhparent=c.oid or h.inhrelid=c.oid))
  from pg_class c where c.oid=to_regclass('cos_mhelp_placement_private.upload_batches') into actual_schema;
  if actual_function is distinct from expected_function or actual_schema is distinct from expected_schema then
    raise exception 'Prior CSV index precondition: function or source catalog changed' using errcode='55000';
  end if;
  select to_regclass('cos_mhelp_placement_private.cos_mhelp_upload_batches_prior_csv_idx')::oid into index_oid;
  select jsonb_build_object(
    'definition',pg_get_indexdef(c.oid),'owner',pg_get_userbyid(c.relowner),
    'kind',c.relkind,'table',i.indrelid::regclass::text,'method',am.amname,
    'valid',i.indisvalid,'ready',i.indisready,'live',i.indislive,
    'unique',i.indisunique,'primary',i.indisprimary,'exclusion',i.indisexclusion,
    'immediate',i.indimmediate,'keyCount',i.indnkeyatts,'attributeCount',i.indnatts,
    'clustered',i.indisclustered,'replicaIdentity',i.indisreplident,
    'nullsNotDistinct',i.indnullsnotdistinct,'tablespace',c.reltablespace::integer,'options',c.reloptions)
  from pg_class c join pg_index i on i.indexrelid=c.oid join pg_am am on am.oid=c.relam
  where c.oid=to_regclass('cos_mhelp_placement_private.cos_mhelp_upload_batches_prior_csv_idx') into actual_index;
  if index_oid is not null and actual_index is distinct from expected_index then
    raise exception 'Prior CSV index precondition: index name or fingerprint changed' using errcode='55000';
  end if;
  select jsonb_build_object(
    'function',(select to_jsonb(p) from pg_proc p where p.oid=to_regprocedure('cos_mhelp_placement_private.shop_address_baseline(text)')),
    'namespace',(select to_jsonb(n) from pg_namespace n where n.nspname='cos_mhelp_placement_private'),
    'columns',(select jsonb_agg(to_jsonb(a) order by a.attnum) from pg_attribute a
      where a.attrelid='cos_mhelp_placement_private.upload_batches'::regclass and a.attnum>0 and not a.attisdropped),
    'policies',(select jsonb_agg(to_jsonb(p) order by p.oid) from pg_policy p
      where p.polrelid='cos_mhelp_placement_private.upload_batches'::regclass),
    'triggers',(select jsonb_agg(to_jsonb(t) order by t.oid) from pg_trigger t
      where t.tgrelid='cos_mhelp_placement_private.upload_batches'::regclass)) into before_security;
  if index_oid is null then
    create index cos_mhelp_upload_batches_prior_csv_idx on cos_mhelp_placement_private.upload_batches
      using btree (admitted_at desc,source_sha256 desc)
      where receipt->>'contract'='COS_MHELP_UPLOAD_V1';
  end if;
  select jsonb_build_object(
    'source_sha256',encode(sha256(convert_to(pg_get_functiondef(p.oid),'UTF8')),'hex'),
    'owner',pg_get_userbyid(p.proowner),'security_definer',p.prosecdef,
    'volatility',p.provolatile,'settings',p.proconfig,'acl',p.proacl::text)
  from pg_proc p where p.oid=to_regprocedure('cos_mhelp_placement_private.shop_address_baseline(text)') into actual_function;
  select jsonb_build_object(
    'relation',c.oid::regclass::text,'kind',c.relkind,'owner',pg_get_userbyid(c.relowner),
    'acl',c.relacl::text,'rls',c.relrowsecurity,'forceRls',c.relforcerowsecurity,
    'columns',(select jsonb_agg(jsonb_build_object('name',a.attname,
      'type',format_type(a.atttypid,a.atttypmod),'notNull',a.attnotnull,
      'default',pg_get_expr(d.adbin,d.adrelid),'collation',a.attcollation::regcollation::text) order by a.attnum)
      from pg_attribute a left join pg_attrdef d on d.adrelid=a.attrelid and d.adnum=a.attnum
      where a.attrelid=c.oid and a.attnum>0 and not a.attisdropped),
    'constraints',(select jsonb_agg(jsonb_build_object('name',k.conname,
      'definition',pg_get_constraintdef(k.oid),'validated',k.convalidated) order by k.conname)
      from pg_constraint k where k.conrelid=c.oid and k.contype<>'n'),
    'indexes',(select jsonb_agg(jsonb_build_object('name',i.indexrelid::regclass::text,
      'definition',pg_get_indexdef(i.indexrelid),'valid',i.indisvalid,'ready',i.indisready,'live',i.indislive)
      order by i.indexrelid::regclass::text) from pg_index i where i.indrelid=c.oid
      and i.indexrelid is distinct from to_regclass('cos_mhelp_placement_private.cos_mhelp_upload_batches_prior_csv_idx')),
    'inherits',(select count(*) from pg_inherits h where h.inhparent=c.oid or h.inhrelid=c.oid))
  from pg_class c where c.oid=to_regclass('cos_mhelp_placement_private.upload_batches') into actual_schema;
  select jsonb_build_object(
    'definition',pg_get_indexdef(c.oid),'owner',pg_get_userbyid(c.relowner),
    'kind',c.relkind,'table',i.indrelid::regclass::text,'method',am.amname,
    'valid',i.indisvalid,'ready',i.indisready,'live',i.indislive,
    'unique',i.indisunique,'primary',i.indisprimary,'exclusion',i.indisexclusion,
    'immediate',i.indimmediate,'keyCount',i.indnkeyatts,'attributeCount',i.indnatts,
    'clustered',i.indisclustered,'replicaIdentity',i.indisreplident,
    'nullsNotDistinct',i.indnullsnotdistinct,'tablespace',c.reltablespace::integer,'options',c.reloptions)
  from pg_class c join pg_index i on i.indexrelid=c.oid join pg_am am on am.oid=c.relam
  where c.oid=to_regclass('cos_mhelp_placement_private.cos_mhelp_upload_batches_prior_csv_idx') into actual_index;
  select jsonb_build_object(
    'function',(select to_jsonb(p) from pg_proc p where p.oid=to_regprocedure('cos_mhelp_placement_private.shop_address_baseline(text)')),
    'namespace',(select to_jsonb(n) from pg_namespace n where n.nspname='cos_mhelp_placement_private'),
    'columns',(select jsonb_agg(to_jsonb(a) order by a.attnum) from pg_attribute a
      where a.attrelid='cos_mhelp_placement_private.upload_batches'::regclass and a.attnum>0 and not a.attisdropped),
    'policies',(select jsonb_agg(to_jsonb(p) order by p.oid) from pg_policy p
      where p.polrelid='cos_mhelp_placement_private.upload_batches'::regclass),
    'triggers',(select jsonb_agg(to_jsonb(t) order by t.oid) from pg_trigger t
      where t.tgrelid='cos_mhelp_placement_private.upload_batches'::regclass)) into after_security;
  if actual_function is distinct from expected_function or actual_schema is distinct from expected_schema
    or after_security is distinct from before_security then
    raise exception 'Prior CSV index postcondition: function, schema, or security changed; transaction must roll back' using errcode='55000';
  end if;
  if actual_index is distinct from expected_index then
    raise exception 'Prior CSV index install postcondition changed; transaction must roll back' using errcode='55000';
  end if;
end $migration$;
commit;
