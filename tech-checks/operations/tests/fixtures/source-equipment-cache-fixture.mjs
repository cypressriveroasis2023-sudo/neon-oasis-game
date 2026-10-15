import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { PGlite } from '@electric-sql/pglite';

export const ORG = 'ece6d2a2-fd19-4cc7-b56a-2fa004a6d8f5';
export const ACTOR = '22222222-2222-4222-8222-222222222222';
export const SOURCE = 'a'.repeat(64), PAYLOAD = 'b'.repeat(64), AUTH = 'c'.repeat(64);
export const id = (kind, number) => `${String(kind).repeat(8)}-${String(kind).repeat(4)}-4${String(kind).repeat(3)}-8${String(kind).repeat(3)}-${String(number).padStart(12, '0')}`;
export const native = number => id(3, number), tracker = number => id(4, number);
export const claim = number => id(5, number), archive = number => id(6, number);
export const sql = name => readFileSync(new URL(`../../db/${name}`, import.meta.url), 'utf8');
export const receiptSql = sql('source-equipment-estimate-receipts.sql');

function section(name, start, end) {
  const source = sql(name), a = source.indexOf(start), b = source.indexOf(end, a);
  assert.ok(a >= 0 && b > a, `Expected SQL section in ${name}`);
  return source.slice(a, b);
}

// Synthetic data only. Production DDL supplies all private dependency tables and
// the exact real upload guard. Native tables have representative mutable columns;
// no provider, socket, browser, external database, or hash stand-in is used.
export async function fixture() {
  const db = new PGlite();
  try {
    await db.exec(`
      set timezone='UTC';
      create role anon; create role authenticated; create role service_role;
      create schema app_private; create schema cos_mhelp_placement_private;
      create table public.organizations(id uuid primary key);
      insert into public.organizations values('${ORG}');
      create table public.equipment_units(
        id uuid primary key, organization_id uuid not null, unit_number text,
        status text, installed_site_id uuid, current_location_ref uuid,
        current_location_type text, retired_at timestamptz, gps_latitude float8,
        gps_longitude float8, gps_recorded_at timestamptz, gps_source text,
        updated_at timestamptz not null default '2026-01-01T00:00:00Z'
      );
      create table public.equipment_unit_location_history(
        id uuid primary key default gen_random_uuid(), equipment_unit_id uuid,
        latitude numeric, longitude numeric, source text, note text,
        recorded_at timestamptz not null default '2026-01-01T00:00:00Z'
      );
      create table public.unchanged_native_inventory(id integer, location jsonb);
      insert into public.unchanged_native_inventory values(1,'{"verified":true,"latitude":31}');
      create function app_private.appdeploy_assume_actor(a uuid,o uuid) returns void language plpgsql as $$
        begin if a is distinct from '${ACTOR}'::uuid then raise exception 'Invalid actor'; end if; end$$;
      create function app_private.has_permission(o uuid,p text) returns boolean language sql as $$
        select coalesce(current_setting('test.permission',true),'true')='true'$$;
    `);
    await db.exec(section('vision_tracker_locations.sql', 'create table if not exists', 'CREATE OR REPLACE FUNCTION'));
    await db.exec(section('cos-geocode-sources.sql', 'create sequence', 'create function app_private.cos_source_assert_service'));
    await db.exec(section('cos-geocode-sources.sql', 'create function app_private.cos_source_address', '-- Only explicitly bound records'));
    await db.exec(section('cos-tracker-source-v2.sql', 'alter table app_private.cos_geocode_sources', 'create or replace function app_private.cos_source_record'));
    await db.exec(section('owner_identity_crosswalk.sql', 'create table app_private.cos_owner_identity_claims', '-- Incarnations exist'));
    await db.exec(section('cos-archived-representations.sql', 'create table app_private.cos_archived_representations', '-- Exactly the reviewed allowlist'));
    await db.exec(section('source-recorded-coordinates.sql', 'create table app_private.cos_source_recorded_coordinates', '-- Used only to reject'));
    await db.exec(section('20261012173408_cos_mhelp_placement_sync.sql', 'create table cos_mhelp_placement_private.links', 'create table cos_mhelp_placement_private.control'));
    await db.exec(section('mhelp_upload_overlay.sql', 'create table cos_mhelp_placement_private.upload_batches', 'create function cos_mhelp_placement_private.review_upload'));
    await db.exec(receiptSql);

    const upload = [1, 2, 3].map(i => ({
      productId: String(i), customerId: '456', customer: 'Example Customer: Example Site',
      unitNumber: `Solar Stand 72 ${i}`, category: 'Support', placement: 'FIELD', lifecycle: 'UNFLAGGED',
      binding: null, placementHeld: false, possibleAliasUnitIds: [],
      sourceAddress: { street: `${i} Main St`, city: 'Houston', state: 'TX', zip: '77002' },
    }));
    await db.query('insert into cos_mhelp_placement_private.upload_batches(source_sha256,payload_sha256,receipt,records) values($1,$2,$3,$4)', [SOURCE, PAYLOAD, { synthetic: true }, upload]);
    await db.query('update cos_mhelp_placement_private.upload_control set active_sha256=$1', [SOURCE]);
    const hash = async value => (await db.query("select encode(sha256(convert_to($1::jsonb::text,'UTF8')),'hex') h", [value])).rows[0].h;
    const textHash = async value => (await db.query("select encode(sha256(convert_to($1,'UTF8')),'hex') h", [value])).rows[0].h;
    const graph = async product => (await db.query('select cos_mhelp_placement_private.source_estimate_linkage_graph($1) g', [product])).rows[0].g;
    const guard = async product => (await db.query('select cos_mhelp_placement_private.source_estimate_linkage_guard($1) g', [product])).rows[0].g;
    const receipts = [];
    for (const u of upload) {
      const address = `${u.productId} main st, houston, tx 77002`;
      const cache = {
        contract: 'COS_SAVED_ADDRESS_CACHE_V1', status: 'success', address, addressSha256: await textHash(address),
        verified: false, liveGps: false, provider: 'us_census_address_range', benchmark: 'Public_AR_Current',
        accuracyType: 'range_interpolation', accuracy: null, matchType: null, latitude: 29, longitude: -95,
        matchedAddress: `${u.productId} MAIN ST, HOUSTON, TX, 77002`, geocodedAt: '2026-01-01T00:00:00Z',
      };
      receipts.push({
        receiptId: `11111111-1111-4111-8111-11111111111${u.productId}`, productId: u.productId,
        uploadRecordSha256: await hash(u), linkageGraphSha256: await guard(u.productId),
        cacheEvidenceSha256: await hash(cache), cacheEvidence: cache,
      });
    }
    const refreshGuards = async () => {
      for (const receipt of receipts) receipt.linkageGraphSha256 = await guard(receipt.productId);
    };
    const admit = async (rs = receipts, source = SOURCE, payload = PAYLOAD, input) =>
      (await db.query('select cos_mhelp_placement_private.review_source_equipment_estimates($1,$2,$3,$4,$5) r',
        [source, payload, input ?? await hash(rs), rs, AUTH])).rows[0].r;
    const snapshot = async (actor = ACTOR, org = ORG) =>
      (await db.query('select public.cos_source_equipment_estimates_snapshot($1,$2) r', [actor, org])).rows[0].r;
    const read = async (role = 'service_role', actor = ACTOR, org = ORG) => {
      assert.ok(['anon', 'authenticated', 'service_role'].includes(role));
      await db.exec(`begin read only; set local role ${role}`);
      try { return await snapshot(actor, org); } finally { await db.exec('rollback'); }
    };
    return { db, upload, receipts, hash, graph, guard, refreshGuards, admit, snapshot, read, close: () => db.close() };
  } catch (error) { await db.close(); throw error; }
}

export async function seedPair(f, number = 1) {
  await f.db.query("insert into public.equipment_units(id,organization_id,unit_number,status) values($1,$2,$3,'available')", [native(number), ORG, `Solar Stand 72 ${number}`]);
  await f.db.query("insert into app_private.vision_tracker_locations(id,organization_id,unit_number,family,placement,customer,address) values($1,$2,$3,'Support','FIELD','Synthetic customer','1 Main St')", [tracker(number), ORG, `Solar Stand 72 ${number}`]);
}
export async function seedSource(f, product = '1', number = 1, active = false) {
  await f.db.query(`insert into app_private.cos_geocode_sources(
    organization_id,entity_kind,native_unit_id,tracker_id,product_id,unit_number,tracker_unit_number,family,
    source_file_sha256,source_row_sha256,native_guard_sha256,source_placement,active,eligibility,source_revision,event_id,
    street,city,state,zip,address_sha256)
    values($1,'equipment_unit',$2,$3,$4,$5,$5,'Support',$6,$6,$6,'FIELD',$7,$8,$9,$10,'1 Main St','Houston','TX','77002',$6)`,
  [ORG, native(number), tracker(number), product, `Solar Stand 72 ${number}`, SOURCE, active, active ? 'FIELD' : 'tombstone', id(7, number), number]);
}
export async function seedLink(f, product = '1', number = 1) {
  await f.db.query(`insert into cos_mhelp_placement_private.links(
    equipment_id,tracker_id,native_unit_id,tracker_label,native_label,full_label,source_revision,baseline_guard,baseline_customer_id,authorization_sha256)
    values($1,$2,$3,$4,$4,$4,$5,$6,'456',$7)`, [product, tracker(number), native(number), `Solar Stand 72 ${number}`, id(7, number), SOURCE, AUTH]);
}
export async function seedClaim(f, product = null, number = 1) {
  await f.db.query(`insert into app_private.cos_owner_identity_claims(
    id,organization_id,native_unit_id,native_unit_label,legacy_unit_key,device_ids,resource_epoch,source_epoch,physical_digest,
    provenance,confirmation_text,evidence_ref,product_association,confirmed_by,request_id,request_payload)
    values($1,$2,$3,$4,$4,array[$5],$6,$6,$6,'owner_confirmation','Synthetic confirmation','synthetic:review',$7,$8,$9,'{}')`,
  [claim(number), ORG, native(number), `Solar Stand 72 ${number}`, String(1000 + number), SOURCE, product === null ? null : { productId: product }, ACTOR, id(8, number)]);
}
export async function seedArchive(f, number = 1, canonical = 4) {
  await f.db.query(`insert into app_private.cos_archived_representations(
    id,organization_id,archived_native_id,canonical_native_id,archived_tracker_id,canonical_tracker_id,reviewed_before,source_evidence,review_sha256,evidence_sha256)
    values($1,$2,$3,$4,$5,$6,'{}','{}',$7,$7)`, [archive(number), ORG, native(number), native(canonical), tracker(number), tracker(canonical), SOURCE]);
}
export async function seedCoordinates(f, product = '1', number = 1, active = false) {
  await f.db.query(`insert into app_private.cos_source_recorded_coordinates(record_id,organization_id,entity_kind,native_unit_id,tracker_id,payload,active)
    values($1,$2,'equipment_unit',$3,$4,$5,$6)`, [id(9, number), ORG, native(number), tracker(number), { productId: product, latitude: 29, longitude: -95 }, active]);
}
export async function seedGraph(f, product = '1', number = 1, canonical = 4) {
  await seedPair(f, number); await seedPair(f, canonical);
  await seedSource(f, product, number); await seedLink(f, product, number); await seedClaim(f, null, number);
  await seedArchive(f, number, canonical); await seedCoordinates(f, product, number);
  await f.db.query("insert into app_private.cos_owner_identity_resources(device_id,claim_id,source,device_type) values($1,$2,'synthetic','camera')", [String(1000 + number), claim(number)]);
  await f.db.query("insert into public.equipment_unit_location_history(equipment_unit_id,latitude,longitude,source,note) values($1,28,-94,'synthetic','Original history')", [native(number)]);
  await f.refreshGuards();
}
export const withDb = fn => async () => {
  const f = await fixture();
  try { await fn(f); } finally { await f.close(); }
};
