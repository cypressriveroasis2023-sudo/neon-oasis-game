import {test, before, after} from 'node:test';
import assert from 'node:assert/strict';
import {readFile} from 'node:fs/promises';
import {PGlite} from '@electric-sql/pglite';

// Production shape on 2026-11-12: 287 sources, 31,288 address rows,
// 30,647 resolutions. The sizes are what make the plan realistic.
const ADDRESSES = 31288, RESOLUTIONS = 30647, SOURCES = 287;
let db;

const plan = async (sql) => (await db.query('explain (analyze, timing off) ' + sql)).rows.map(r => r['QUERY PLAN']);
const refuses = async (sql, pattern) => {
  try { await db.exec(sql); } catch (error) { assert.match(String(error.message || error), pattern); return; }
  throw new Error('Expected a refusal matching ' + pattern);
};

before(async () => {
  db = new PGlite();
  await db.exec(`create role anon;create role authenticated;create role service_role bypassrls;
   create schema cos_mhelp_placement_private;
   create table cos_mhelp_placement_private.census_mhelp_address(source_sha256 text,address_sha256 text,
     street text,city text,state text,zip text,status text,census_benchmark text,completed_at timestamptz,
     primary key(source_sha256,address_sha256));
   create table cos_mhelp_placement_private.mhelp_address_resolution(id bigint generated always as identity primary key,
     source_sha256 text,payload_sha256 text,address_sha256 text,status text,geocoded_at timestamptz,evidence jsonb);
   create table cos_mhelp_placement_private.census_mhelp_product(source_sha256 text,payload_sha256 text,product_id text,
     address_sha256 text,placement text,primary key(source_sha256,product_id));
   create index census_mhelp_product_address on cos_mhelp_placement_private.census_mhelp_product(source_sha256,address_sha256);`);
  // The existing normalizer, copied from mhelp-address-automation.sql.
  await db.exec(`create function cos_mhelp_placement_private.address_parts_v1(a jsonb) returns jsonb
   language sql immutable set search_path='' as $$
   select jsonb_build_object('street',upper(trim(regexp_replace(coalesce(a->>'street',''),'[[:space:]]+',' ','g'))),
    'city',upper(trim(regexp_replace(coalesce(a->>'city',''),'[[:space:]]+',' ','g'))),
    'state',upper(trim(coalesce(a->>'state',''))),'zip',left(trim(coalesce(a->>'zip','')),5)) $$;`);
  await db.exec(`
   insert into cos_mhelp_placement_private.census_mhelp_address(source_sha256,address_sha256,street,city,state,zip,status,census_benchmark,completed_at)
    select 'src'||((g%${SOURCES})+1),'addr'||g,
      case when g%11=0 then '  '||(1000+g)||'   main   st  ' else (1000+g)||' MAIN ST' end,
      case when g%13=0 then 'houston' else 'HOUSTON' end,'tx',lpad((g%99999)::text,5,'0')||'-1234',
      case when g%7=0 then 'matched' else 'no_match' end,'Public_AR_Current',now()
    from generate_series(1,${ADDRESSES}) g;
   insert into cos_mhelp_placement_private.mhelp_address_resolution(source_sha256,payload_sha256,address_sha256,status,geocoded_at,evidence)
    select 'src'||((g%${SOURCES})+1),'pay'||((g%${SOURCES})+1),'addr'||g,'matched',now(),
      case when g%500=0 then jsonb_build_object('ownerCorrectedAddress',jsonb_build_object('street',(1000+g)||' LEE RD','city','HOUSTON','state','TX','zip','77002')) else '{}'::jsonb end
    from generate_series(1,${RESOLUTIONS}) g;
   analyze;`);
});
after(async () => db?.close());

test('the index the obvious fix would create is refused, because jsonb_build_object is only STABLE', async () => {
  assert.equal((await db.query("select provolatile::text v from pg_proc where proname='jsonb_build_object' limit 1")).rows[0].v, 's');
  await refuses(`create index obvious_idx on cos_mhelp_placement_private.census_mhelp_address
    ((cos_mhelp_placement_private.address_parts_v1(jsonb_build_object('street',street,'city',city,'state',state,'zip',zip))));`,
    /must be marked IMMUTABLE/);
});

test('the comparison as the sync writes it reads every address row', async () => {
  const lines = await plan(`select count(*) from cos_mhelp_placement_private.census_mhelp_address a
   where a.source_sha256<>'src1'
   and cos_mhelp_placement_private.address_parts_v1(jsonb_build_object('street',a.street,'city',a.city,'state',a.state,'zip',a.zip))
     = cos_mhelp_placement_private.address_parts_v1(jsonb_build_object('street','2500 MAIN ST','city','HOUSTON','state','TX','zip','01500'))`);
  assert.ok(lines.some(line => /Seq Scan on census_mhelp_address/.test(line)), lines.join('\n'));
  assert.ok(lines.some(line => /Rows Removed by Filter: 3[0-9]{4}/.test(line)), 'it should have filtered tens of thousands of rows');
});

test('the column wrapper is installable and agrees with the original on every row', async () => {
  await db.exec(await readFile(new URL('../db/20261112_address_automation_parts_index.sql', import.meta.url), 'utf8'));
  const {rows} = await db.query(`select count(*) n from cos_mhelp_placement_private.census_mhelp_address a
   where cos_mhelp_placement_private.address_parts_v1(jsonb_build_object('street',a.street,'city',a.city,'state',a.state,'zip',a.zip))
      <> cos_mhelp_placement_private.address_parts_columns_v1(a.street,a.city,a.state,a.zip)`);
  assert.equal(Number(rows[0].n), 0, 'the indexable wrapper must normalize identically');
  const {rows: idx} = await db.query(`select indexname from pg_indexes where schemaname='cos_mhelp_placement_private' order by indexname`);
  for (const name of ['census_mhelp_address_parts_idx','census_mhelp_product_address_field_idx','mhelp_address_resolution_corrected_parts_idx']) {
    assert.ok(idx.some(row => row.indexname === name), name + ' was not created');
  }
});

test('installing it twice changes nothing', async () => {
  await db.exec(await readFile(new URL('../db/20261112_address_automation_parts_index.sql', import.meta.url), 'utf8'));
  const {rows} = await db.query(`select count(*) n from pg_indexes where schemaname='cos_mhelp_placement_private' and indexname='census_mhelp_address_parts_idx'`);
  assert.equal(Number(rows[0].n), 1);
});

test('the indexes alone do not help: the OR across two tables defeats them', async () => {
  const lines = await plan(`select a.address_sha256 from cos_mhelp_placement_private.census_mhelp_address a
   join cos_mhelp_placement_private.mhelp_address_resolution f on f.source_sha256=a.source_sha256 and f.address_sha256=a.address_sha256
   where a.source_sha256<>'src1'
   and (cos_mhelp_placement_private.address_parts_columns_v1(a.street,a.city,a.state,a.zip)
         = cos_mhelp_placement_private.address_parts_columns_v1('2500 MAIN ST','HOUSTON','TX','01500')
     or f.evidence->'ownerCorrectedAddress' is not null
      and cos_mhelp_placement_private.address_parts_v1(f.evidence->'ownerCorrectedAddress')
         = cos_mhelp_placement_private.address_parts_columns_v1('2500 MAIN ST','HOUSTON','TX','01500'))`);
  assert.ok(lines.some(line => /Seq Scan/.test(line)),
    'the OR must still force a scan, which is why the sync has to be split: ' + lines.join('\n'));
});

test('split into two branches, the same lookup is an index scan on each side', async () => {
  const target = `cos_mhelp_placement_private.address_parts_columns_v1('2500 MAIN ST','HOUSTON','TX','01500')`;
  const lines = await plan(`
   select a.source_sha256,a.address_sha256 from cos_mhelp_placement_private.census_mhelp_address a
    where a.source_sha256<>'src1' and cos_mhelp_placement_private.address_parts_columns_v1(a.street,a.city,a.state,a.zip)=${target}
   union
   select f.source_sha256,f.address_sha256 from cos_mhelp_placement_private.mhelp_address_resolution f
    where f.evidence ? 'ownerCorrectedAddress' and f.source_sha256<>'src1'
     and cos_mhelp_placement_private.address_parts_columns_v1(
      f.evidence->'ownerCorrectedAddress'->>'street',f.evidence->'ownerCorrectedAddress'->>'city',
      f.evidence->'ownerCorrectedAddress'->>'state',f.evidence->'ownerCorrectedAddress'->>'zip')=${target}`);
  assert.equal(lines.filter(line => /Index Scan|Bitmap Index Scan/.test(line)).length, 2, lines.join('\n'));
  assert.ok(!lines.some(line => /Seq Scan on census_mhelp_address/.test(line)), lines.join('\n'));
  const ms = Number(/Execution Time: ([0-9.]+) ms/.exec(lines.join('\n'))?.[1] ?? 'NaN');
  assert.ok(ms < 50, 'the split lookup should be milliseconds, was ' + ms + 'ms');
});
