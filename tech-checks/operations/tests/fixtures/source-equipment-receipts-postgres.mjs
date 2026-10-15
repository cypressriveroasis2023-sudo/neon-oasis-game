// Synthetic dependency fixture. Never load a monolithic production bundle.
import assert from 'node:assert/strict';
import {readFileSync} from 'node:fs';
import {createHash} from 'node:crypto';

export const id = (kind, n) => `${String(kind).repeat(8)}-${String(kind).repeat(4)}-4${String(kind).repeat(3)}-8${String(kind).repeat(3)}-${String(n).padStart(12, '0')}`;
export const ORG = id(1, 1), ACTOR = id(2, 1), native = n => id(3, n), tracker = n => id(4, n);
export const SOURCE = 'a'.repeat(64), PAYLOAD = 'b'.repeat(64), AUTH = 'c'.repeat(64);
export const HASH = text => createHash('sha256').update(text).digest('hex');
export const RECEIPT_FILE = 'source-equipment-estimate-receipts.sql';
const source = name => readFileSync(new URL(`../../db/${name}`, import.meta.url), 'utf8');
const reviewed = source(RECEIPT_FILE);
export const REVIEWED_RECEIPT_SHA256 = 'bf63cc7644ff8176f7225ae5f7b90ae6bc6873a8d0b8f4c7a752319c82ba895c';
assert.equal(HASH(reviewed), REVIEWED_RECEIPT_SHA256, 'Receipt SQL changed: review and update the proof pin');
// The sole tenant equality and dependency-table tenant constraints are remapped,
// not removed. All receipt, graph, continuity and identity logic is unchanged.
const tenantMatches = [...reviewed.matchAll(/p_organization_id is distinct from '([a-f0-9-]{36})'::uuid/g)];
assert.equal(tenantMatches.length, 1, 'Exactly one tenant guard must be reviewed');
const originalTenant = tenantMatches[0][1];
assert.equal(reviewed.split(originalTenant).length - 1, 1);
export const inputManifest = [];
function load(name, start, end, tenantCount = 0) {
  const file = source(name);
  let text = file;
  if (start) {
    const a = file.indexOf(start), b = file.indexOf(end, a);
    assert.ok(a >= 0 && b > a && file.indexOf(start, a + 1) < 0, `Unique bounded SQL slice: ${name}`);
    text = file.slice(a, b);
  }
  assert.equal(text.split(originalTenant).length - 1, tenantCount, `Tenant remap count: ${name}`);
  const synthetic = text.replaceAll(originalTenant, ORG);
  assert.equal(synthetic.replaceAll(ORG,originalTenant),text,'Only the tenant literal may change');
  inputManifest.push({file: name,start:start??null,end:end??null,originalSha256:HASH(text),syntheticSha256:HASH(synthetic),tenantSubstitutions:tenantCount});
  return synthetic;
}
export const TABLES = [
  'public.organizations', 'public.equipment_units', 'public.equipment_unit_location_history',
  'app_private.vision_tracker_locations', 'app_private.cos_geocode_sources', 'app_private.cos_geocode_source_events',
  'cos_mhelp_placement_private.links', 'cos_mhelp_placement_private.upload_batches',
  'cos_mhelp_placement_private.upload_control', 'cos_mhelp_placement_private.upload_audit',
  'app_private.cos_owner_identity_claims', 'app_private.cos_owner_identity_resources', 'app_private.cos_owner_identity_revocations',
  'app_private.cos_archived_representations', 'app_private.cos_archived_representation_revocations',
  'app_private.cos_source_recorded_coordinates', 'cos_mhelp_placement_private.source_equipment_estimates',
  'cos_mhelp_placement_private.source_equipment_estimate_revocations',
];
export const GRAPH_TABLES = [
  'app_private.vision_tracker_locations', 'public.equipment_units', 'app_private.cos_geocode_sources',
  'cos_mhelp_placement_private.links', 'public.equipment_unit_location_history', 'app_private.cos_owner_identity_claims',
  'app_private.cos_owner_identity_resources', 'app_private.cos_owner_identity_revocations',
  'app_private.cos_archived_representations', 'app_private.cos_archived_representation_revocations',
  'app_private.cos_source_recorded_coordinates',
];

export async function fixture(db) {
  inputManifest.length = 0;
  await db.exec(`set timezone='UTC';
    create role anon; create role authenticated; create role service_role;
    create schema app_private; create schema cos_mhelp_placement_private;
    revoke all on schema cos_mhelp_placement_private from public,anon,authenticated,service_role;
    create table public.organizations(id uuid primary key);
    insert into public.organizations values('${ORG}');
    create table public.equipment_units(
      id uuid primary key,organization_id uuid not null,unit_number text,status text,
      installed_site_id uuid,current_location_ref uuid,current_location_type text,retired_at timestamptz,
      gps_latitude float8,gps_longitude float8,gps_recorded_at timestamptz,gps_source text,
      updated_at timestamptz not null default '2026-01-01T00:00:00Z');
    create table public.equipment_unit_location_history(
      id uuid primary key default gen_random_uuid(),equipment_unit_id uuid,latitude numeric,longitude numeric,
      source text,note text,recorded_at timestamptz not null default '2026-01-01T00:00:00Z');
    -- Strict synthetic auth boundary, not a claim about deployed actor authorization.
    create function app_private.appdeploy_assume_actor(a uuid,o uuid) returns void language plpgsql as $$
      begin if a is distinct from '${ACTOR}'::uuid then raise exception 'Invalid synthetic actor' using errcode='42501'; end if; end$$;
    create function app_private.has_permission(o uuid,p text) returns boolean language sql as $$
      select o='${ORG}'::uuid and p='equipment.view' and coalesce(current_setting('test.permission',true),'true')='true'$$;
  `);
  const sections = [
    ['vision_tracker_locations.sql', 'create table if not exists', 'CREATE OR REPLACE FUNCTION'],
    ['cos-geocode-sources.sql', 'create sequence', 'create function app_private.cos_source_assert_service', 1],
    ['cos-geocode-sources.sql', 'create function app_private.cos_source_address', '-- Only explicitly bound records'],
    ['cos-tracker-source-v2.sql', 'alter table app_private.cos_geocode_sources\n alter column product_id', 'create or replace function app_private.cos_source_record'],
    ['owner_identity_crosswalk.sql', 'create table app_private.cos_owner_identity_claims', '-- Incarnations exist', 1],
    ['cos-archived-representations.sql', 'create table app_private.cos_archived_representations', '-- Exactly the reviewed allowlist', 1],
    ['source-recorded-coordinates.sql', 'create table app_private.cos_source_recorded_coordinates', '-- Used only to reject', 1],
    ['20261012173408_cos_mhelp_placement_sync.sql', 'create table cos_mhelp_placement_private.links', 'create table cos_mhelp_placement_private.control'],
    ['mhelp_upload_overlay.sql', 'create table cos_mhelp_placement_private.upload_batches', 'create function cos_mhelp_placement_private.review_upload'],
  ];
  for (const section of sections) await db.exec(load(...section));
  await db.exec(load(RECEIPT_FILE, null, null, 1));
  // Bulk-generated IDs and addresses are synthetic. No real records are embedded.
  await db.exec(`create function public.synthetic_receipt_id(k integer,n integer) returns uuid language sql immutable as $$
    select (repeat(k::text,8)||'-'||repeat(k::text,4)||'-4'||repeat(k::text,3)||'-8'||repeat(k::text,3)||'-'||lpad(n::text,12,'0'))::uuid$$;
    insert into public.equipment_units(id,organization_id,unit_number,status)
      select public.synthetic_receipt_id(3,i),'${ORG}','Synthetic unit '||i,'available' from generate_series(1,810) i;
    insert into app_private.vision_tracker_locations(id,organization_id,unit_number,family,placement,customer,address,imported_at)
      select public.synthetic_receipt_id(4,i),'${ORG}','Synthetic unit '||i,'Support','FIELD','Synthetic customer',
        i||' Synthetic Receipt Lane, Exampleville, TX 00000','2026-01-01T00:00:00Z' from generate_series(1,810) i;
    insert into app_private.cos_geocode_sources(organization_id,entity_kind,native_unit_id,tracker_id,product_id,
      unit_number,tracker_unit_number,family,source_file_sha256,source_row_sha256,native_guard_sha256,
      source_placement,active,eligibility,source_revision,event_id,street,city,state,zip,address_sha256,imported_at)
      select '${ORG}','equipment_unit',public.synthetic_receipt_id(3,i),public.synthetic_receipt_id(4,i),i::text,
        'Synthetic unit '||i,'Synthetic unit '||i,'Support','${SOURCE}','${SOURCE}','${SOURCE}',
        'FIELD',i>3 and i%4<>0,case when i>3 and i%4<>0 then 'FIELD' else 'tombstone' end,
        public.synthetic_receipt_id(7,i),i,i||' Synthetic Receipt Lane','Exampleville','TX','00000','${SOURCE}','2026-01-01T00:00:00Z'
      from generate_series(1,810) i where i<>3;
    insert into cos_mhelp_placement_private.links(equipment_id,tracker_id,native_unit_id,tracker_label,native_label,
      full_label,source_revision,baseline_guard,baseline_customer_id,authorization_sha256,reviewed_at)
      select i::text,public.synthetic_receipt_id(4,i),public.synthetic_receipt_id(3,i),'Synthetic unit '||i,
        'Synthetic unit '||i,'Synthetic unit '||i,public.synthetic_receipt_id(7,i),'${SOURCE}','456','${AUTH}','2026-01-01T00:00:00Z'
      from generate_series(4,810) i;
    insert into app_private.cos_owner_identity_claims(id,organization_id,native_unit_id,native_unit_label,legacy_unit_key,
      device_ids,resource_epoch,source_epoch,physical_digest,provenance,confirmation_text,evidence_ref,
      confirmed_by,confirmed_at,request_id,request_payload)
      select public.synthetic_receipt_id(5,i),'${ORG}',public.synthetic_receipt_id(3,i),'Synthetic unit '||i,'SYNTHETIC-'||i,
        array[(1000+i)::text],'${SOURCE}','${SOURCE}','${SOURCE}','owner_confirmation','Synthetic confirmation','synthetic:fixture',
        '${ACTOR}','2026-01-01T00:00:00Z',public.synthetic_receipt_id(8,i),'{}' from generate_series(4,100) i;
    insert into app_private.cos_owner_identity_resources(device_id,claim_id,source,device_type)
      select (1000+i)::text,public.synthetic_receipt_id(5,i),'synthetic','camera' from generate_series(4,100) i;
    insert into app_private.cos_archived_representations(id,organization_id,archived_native_id,canonical_native_id,
      archived_tracker_id,canonical_tracker_id,reviewed_before,source_evidence,review_sha256,evidence_sha256,recorded_at)
      select public.synthetic_receipt_id(6,i),'${ORG}',public.synthetic_receipt_id(3,i),public.synthetic_receipt_id(3,270+i),
        public.synthetic_receipt_id(4,i),public.synthetic_receipt_id(4,270+i),'{}','{}','${SOURCE}','${SOURCE}','2026-01-01T00:00:00Z'
      from generate_series(4,30) i;
    insert into app_private.cos_source_recorded_coordinates(record_id,organization_id,entity_kind,native_unit_id,tracker_id,payload,active,applied_at)
      select public.synthetic_receipt_id(9,i),'${ORG}','equipment_unit',public.synthetic_receipt_id(3,270+i),
        public.synthetic_receipt_id(4,540+i),jsonb_build_object('productId',(540+i)::text,'latitude',0,'longitude',0),false,'2026-01-01T00:00:00Z'
      from generate_series(4,30) i;
    insert into public.equipment_unit_location_history(id,equipment_unit_id,latitude,longitude,source,note)
      select public.synthetic_receipt_id(0,i),public.synthetic_receipt_id(3,i),0,0,'synthetic','Original synthetic history'
      from generate_series(1,810) i;
  `);
  const upload = Array.from({length:1001}, (_, index) => {
    const i = index + 1;
    return {productId:String(i),customerId:'456',customer:'Synthetic customer',unitNumber:`Synthetic unit ${i}`,
      category:'Support',placement:'FIELD',lifecycle:'UNFLAGGED',binding:null,placementHeld:false,possibleAliasUnitIds:[],
      sourceAddress:{street:`${i} Synthetic Receipt Lane`,city:'Exampleville',state:'TX',zip:'00000'}};
  });
  await db.query('insert into cos_mhelp_placement_private.upload_batches(source_sha256,payload_sha256,receipt,records) values($1,$2,$3,$4)',
    [SOURCE,PAYLOAD,{synthetic:true,trackerRecordCount:810},upload]);
  await db.query('update cos_mhelp_placement_private.upload_control set active_sha256=$1',[SOURCE]);
  const hash = async value => (await db.query("select encode(sha256(convert_to($1::jsonb::text,'UTF8')),'hex') h",[value])).rows[0].h;
  const graph = async product => (await db.query('select cos_mhelp_placement_private.source_estimate_linkage_graph($1) g',[product])).rows[0].g;
  const guard = async product => (await db.query('select cos_mhelp_placement_private.source_estimate_linkage_guard($1) g',[product])).rows[0].g;
  const receipts = [];
  for (const u of upload.slice(0,3)) {
    const address = `${u.productId} synthetic receipt lane, exampleville, tx 00000`;
    const cache = {contract:'COS_SAVED_ADDRESS_CACHE_V1',status:'success',address,addressSha256:HASH(address),verified:false,liveGps:false,
      provider:'us_census_address_range',benchmark:'Public_AR_Current',accuracyType:'range_interpolation',accuracy:null,matchType:null,
      latitude:0,longitude:0,matchedAddress:address.toUpperCase(),geocodedAt:'2026-01-01T00:00:00Z'};
    receipts.push({receiptId:id(1,100+Number(u.productId)),productId:u.productId,uploadRecordSha256:await hash(u),
      linkageGraphSha256:await guard(u.productId),cacheEvidenceSha256:await hash(cache),cacheEvidence:cache});
  }
  const admit = async (rs=receipts, source=SOURCE, payload=PAYLOAD, input, authorization=AUTH) =>
    (await db.query('select cos_mhelp_placement_private.review_source_equipment_estimates($1,$2,$3,$4,$5) result',
      [source,payload,input??await hash(rs),rs,authorization])).rows[0].result;
  const revoke = async (ids=receipts.map(r=>r.receiptId), authorization=AUTH) =>
    (await db.query('select cos_mhelp_placement_private.revoke_source_equipment_estimates($1::uuid[],$2) result',[`{${ids.join(',')}}`,authorization])).rows[0].result;
  const snapshot = async (actor=ACTOR,org=ORG) =>
    (await db.query('select public.cos_source_equipment_estimates_snapshot($1,$2) result',[actor,org])).rows[0].result;
  const read = async (role='service_role',actor=ACTOR,org=ORG) => {
    assert.ok(['anon','authenticated','service_role'].includes(role));
    await db.exec(`begin read only; set local role ${role}`);
    try { return await snapshot(actor,org); } finally { await db.exec('rollback'); }
  };
  const state = async (includeReceipts=true) => {
    const hashes = {};
    for (const table of TABLES.filter(t=>includeReceipts||!t.includes('source_equipment_estimate'))) {
      const value = (await db.query(`select count(*)::int count,encode(sha256(convert_to(coalesce(jsonb_agg(to_jsonb(t) order by to_jsonb(t)::text),'[]')::text,'UTF8')),'hex') sha256 from ${table} t`)).rows[0];
      hashes[table] = value;
    }
    return hashes;
  };
  const counts = async () => (await db.query(`select
    (select jsonb_array_length(records) from cos_mhelp_placement_private.upload_batches where source_sha256='${SOURCE}') uploads,
    (select count(*)::int from app_private.vision_tracker_locations) trackers,
    (select count(*)::int from public.equipment_units) native,
    (select count(*)::int from app_private.cos_geocode_sources) sources,
    (select count(*)::int from cos_mhelp_placement_private.links) links,
    (select count(*)::int from app_private.cos_owner_identity_claims) owner_claims,
    (select count(*)::int from app_private.cos_owner_identity_resources) owner_resources,
    (select count(*)::int from app_private.cos_archived_representations) archives,
    (select count(*)::int from app_private.cos_source_recorded_coordinates) coordinates,
    (select count(*)::int from public.equipment_unit_location_history) history,
    (select count(*)::int from cos_mhelp_placement_private.source_equipment_estimates) receipts,
    (select count(*)::int from cos_mhelp_placement_private.source_equipment_estimate_revocations) revocations`)).rows[0];
  await db.exec('analyze');
  return {db,upload,receipts,hash,graph,guard,admit,revoke,snapshot,read,state,counts};
}
