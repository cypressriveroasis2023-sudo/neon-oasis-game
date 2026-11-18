import test from 'node:test';
import assert from 'node:assert/strict';
import {readFile} from 'node:fs/promises';
import {PGlite} from '@electric-sql/pglite';
import {assertCensusMethod, assertCensusPath, customerNamePath, ticketListPath} from '../../supabase/functions/cos-mhelp-ticket-census/allowlist.ts';
import {assertTcpProject} from '../../supabase/functions/cos-mhelp-ticket-census/projectGuard.ts';
import {ticketBudgetPlan, censusBackoffMs, DATA_DAILY_CAP, INVENTORY_DAY_RESERVE, TICKET_DAILY_CAP, TICKET_RUN_CAP, TICKET_RUNS_PER_DAY} from '../../supabase/functions/cos-mhelp-ticket-census/budget.ts';
import {normalizeMhelpId, projectCensusTicket, closedStatusLabel} from '../../supabase/functions/cos-mhelp-ticket-census/project.ts';
import {emptyCursor, readTicketCensus} from '../../supabase/functions/cos-mhelp-ticket-census/read.ts';
import {createTicketCensusHandler, persistCensusChunk} from '../../supabase/functions/cos-mhelp-ticket-census/index.ts';

const portal = 224643;
const forbidden = ['drop-me-note', 'drop-me-contact', 'drop-me-street', 'drop-me-staff'];
const ticket = (overrides = {}) => ({portalId: portal, ticketId: 10, ticketNumber: 100, typeId: 11, typeName: 'Install', statusId: 1, ticketStatus: 'New',
  deleted: false, creationDate: '2026-11-18T15:00:00.000Z', lastModDate: '2026-11-18T16:00:00.000Z', scheduledDate: '2026-11-19T15:00:00.000Z',
  customerId: 20, subject: 'drop-me-note', comment: 'drop-me-note', summary: 'drop-me-note', assignedTo: 'drop-me-staff',
  customFields: [{fieldValue: 'drop-me-note'}], items: [{notes: 'drop-me-note', priceListId: 55, description: 'drop-me-note'}],
  address1: 'drop-me-street', ...overrides});
const json = (value, status = 200, headers = {}) => new Response(JSON.stringify(value), {status, headers: {'Content-Type': 'application/json', ...headers}});
const statuses = [{statusId: 1, statusText: 'New', displayText: 'New', parentId: null, canBeParent: true}, {statusId: 2, statusText: 'Complete', displayText: 'Complete', parentId: null, canBeParent: false}];
const types = {totalRows: 1, data: [{portalId: portal, typeId: 11, typeName: 'Install', isActive: true, description: 'drop-me-note'}]};

function vendor(rows, options = {}) {
  const calls = [];
  const fetch = async (url, init = {}) => {
    calls.push({url: String(url), method: init.method || 'GET', headers: init.headers || {}});
    if ((init.method || 'GET') !== 'GET') throw new Error('vendor write');
    const parsed = new URL(url);
    if (options.fail && parsed.pathname.endsWith(options.fail)) return json({error: 'hidden'}, options.status || 401);
    if (parsed.pathname.endsWith('/ticketstatus')) return json(statuses);
    if (parsed.pathname.endsWith('/tickettypes')) return json(types);
    if (parsed.pathname.includes('/customers/')) return json(options.customer || {customerId: 20, portalId: portal, name: 'Synthetic Yard', address1: 'drop-me-street', notes: 'drop-me-note', primaryPhone: 'drop-me-contact'});
    if (parsed.pathname.includes('/Equipment/')) {
      const equipmentId = parsed.pathname.split('/').at(-2);
      return json({totalRows: 1, data: [ticket({ticketId: 77, ticketNumber: 770, customerId: null, equipmentId: undefined, priceListId: 55})]});
    }
    const rowIndex = parsed.searchParams.get('rowIndex');
    const selected = parsed.searchParams.get('statusId') === '1' ? rows : [];
    const start = rowIndex == null ? 0 : Number(rowIndex) - 1;
    return json({totalRows: selected.length, data: selected.slice(start, start + 50)});
  };
  return {fetch, calls};
}

test('non-GET methods and unlisted paths are rejected before a request', () => {
  for (const method of ['POST', 'PUT', 'PATCH', 'DELETE', 'HEAD']) assert.throws(() => assertCensusMethod(method), error => error.message === 'mhelp_write_blocked');
  assert.doesNotThrow(() => assertCensusMethod('GET'));
  for (const path of ['/portal/224643/Tickets?description=drop-me-note&pageSize=50&sort=ticketId', '/portal/224643/Tickets?pageSize=50&sort=ticketId', '/portal/224643/customers/20?Fields=customerId,portalId,name,address1', '/portal/224643/Equipment/20/Tickets?pageSize=50&sort=ticketId&fields=comment', '/portal/224643/Tickets/10?comment=drop-me-note']) {
    assert.throws(() => assertCensusPath(path, String(portal)), error => error.message === 'mhelp_path_rejected');
  }
  assert.equal(customerNamePath(String(portal), '20'), '/portal/224643/customers/20?Fields=customerId,portalId,name');
  assert.doesNotThrow(() => assertCensusPath(ticketListPath(String(portal), {statusId: '0'}, null), String(portal)));
  assert.doesNotThrow(() => assertCensusPath('/portal/224643/Tickets/10', String(portal)));
});

test('census rows keep only the duplicate-check columns and the normalized A#', async () => {
  const rows = Array.from({length: 60}, (_, index) => ticket({ticketId: index + 1, ticketNumber: 1000 + index}));
  const {fetch, calls} = vendor(rows);
  let clock = Date.parse('2026-11-18T18:00:00.000Z');
  const result = await readTicketCensus({fetch, portalId: String(portal), accessToken: 'synthetic-census-token', equipmentIds: ['1001', 'A1001', '01001'], now: () => clock, wait: async () => { throw new Error('unexpected wait'); }});
  assert.equal(result.state, 'completed');
  assert.equal(result.rows.length, 61);
  const stored = result.rows.find(row => row.ticketId === '77');
  assert.equal(stored.equipmentId, '1001');
  assert.equal(stored.customerName, null);
  assert.equal(result.rows.find(row => row.ticketId === '1').customerName, 'Synthetic Yard');
  assert.equal(result.rows.find(row => row.ticketId === '1').status, 'New');
  assert.equal(result.rows.find(row => row.ticketId === '1').type, 'Install');
  assert.deepEqual(Object.keys(result.rows[0]).sort(), ['createdAt', 'customerName', 'equipmentId', 'scheduledAt', 'status', 'ticketId', 'ticketNumber', 'type']);
  const body = JSON.stringify(result.rows);
  for (const secret of [...forbidden, 'synthetic-census-token', 'priceListId']) assert.equal(body.includes(secret), false, secret);
  assert.equal(calls.every(call => call.method === 'GET'), true);
  assert.equal(calls.some(call => call.url.includes('statusId=2')), false);
  assert.equal(calls.some(call => call.url.includes('lastModDate=') || call.url.includes('description=')), false);
  const listed = calls.filter(call => call.url.includes('/Tickets?'));
  assert.equal(listed.some(call => new URL(call.url).searchParams.get('rowIndex') === '51'), true);
  assert.equal(result.cursor.equipmentOrdinal, 0);
  assert.equal(result.cursor.equipmentSweepCount, 1);
});

test('a ticket read 401 or 403 stops the run without a retry', async () => {
  for (const status of [401, 403]) {
    const {fetch, calls} = vendor([], {fail: '/ticketstatus', status});
    const waits = [];
    const result = await readTicketCensus({fetch, portalId: String(portal), accessToken: 'synthetic-census-token', wait: async ms => { waits.push(ms); }});
    assert.equal(result.state, 'stopped');
    assert.equal(result.reason, 'mhelp_ticket_access_denied');
    assert.equal(calls.length, 1);
    assert.equal(waits.length, 0);
    assert.equal(result.rows.length, 0);
  }
});

test('provider 429 waits with exponential backoff and a long Retry-After stops without losing earlier rows', async () => {
  const calls = [];
  const waits = [];
  let now = Date.parse('2026-11-18T18:00:00.000Z');
  const fetch = async () => {
    calls.push(now);
    return json({error: 'hidden'}, 429, {'Retry-After': '1'});
  };
  const limited = await readTicketCensus({fetch, portalId: String(portal), accessToken: 'synthetic-census-token', now: () => now, wait: async ms => { waits.push(ms); now += ms; }});
  assert.equal(limited.reason, 'mhelp_rate_limited');
  assert.deepEqual(waits, [1000, 2000]);
  assert.equal(calls.length, 3);
  const progress = [];
  const longWait = await readTicketCensus({
    fetch: async (url) => {
      calls.push(String(url));
      if (String(url).endsWith('/ticketstatus')) return json(statuses);
      return json({error: 'hidden'}, 429, {'Retry-After': '9'});
    },
    portalId: String(portal), accessToken: 'synthetic-census-token', now: () => now,
    onProgress: async (rows, cursor) => { progress.push({rows: rows.length, reads: cursor.readsToday}); },
    wait: async () => { throw new Error('waited past the function budget'); },
  });
  assert.equal(longWait.reason, 'mhelp_rate_limited');
  assert.equal(censusBackoffMs(0, '9', now), 9000);
  assert.equal(progress.at(-1).reads > 0, true);
  const budgetCalls = [];
  const budget = await readTicketCensus({fetch: async () => { budgetCalls.push(1); return json({}, 429, {'X-COS-Mhelp-Budget': '1', 'Retry-After': '30'}); }, portalId: String(portal), accessToken: 'synthetic-census-token', wait: async () => { throw new Error('budget retry'); }});
  assert.equal(budget.reason, 'daily_budget');
  assert.equal(budgetCalls.length, 1);
  const deferred = await readTicketCensus({fetch: async () => json({}, 429, {'X-COS-Mhelp-Deferred': '1'}), portalId: String(portal), accessToken: 'synthetic-census-token', wait: async () => { throw new Error('deferred retry'); }});
  assert.equal(deferred.reason, 'provider_wait');
  assert.equal(censusBackoffMs(0, null, now), 1000);
  assert.equal(censusBackoffMs(1, null, now), 2000);
  assert.equal(censusBackoffMs(2, '30', now), 30000);
});

test('ticket reads stay inside the shared daily admission', () => {
  const plan = ticketBudgetPlan();
  assert.equal(plan.ticketDailyMax, TICKET_RUN_CAP * TICKET_RUNS_PER_DAY);
  assert.equal(plan.combined, INVENTORY_DAY_RESERVE + plan.ticketDailyMax);
  assert.equal(plan.combined, 3752);
  assert.equal(plan.dataCap, DATA_DAILY_CAP);
  assert.equal(plan.fits, true);
  assert.ok(plan.combined < 5000);
  assert.ok(plan.combined <= 4600);
});

test('A# matching uses the existing numeric equipment id', () => {
  assert.equal(normalizeMhelpId(1001), '1001');
  assert.equal(normalizeMhelpId('1001'), '1001');
  for (const value of ['A1001', '01001', '0', '', '1001.5', null]) assert.equal(normalizeMhelpId(value), null);
  assert.equal(closedStatusLabel('Complete'), true);
  assert.equal(closedStatusLabel('Incomplete repair'), false);
  const labels = {status: new Map([['1', 'New']]), type: new Map([['11', 'Install']])};
  const disagreed = projectCensusTicket(ticket({equipmentId: 9999}), labels, '1001', String(portal));
  assert.equal(disagreed.row.equipmentId, null);
  const fromPath = projectCensusTicket(ticket(), labels, '1001', String(portal));
  assert.equal(fromPath.row.equipmentId, '1001');
  assert.equal('subject' in fromPath.row, false);
});

test('the scheduled handler reports access denial and does not accept a job write', async () => {
  const errors = [];
  const original = console.error;
  console.error = (...args) => { errors.push(args); };
  try {
    const saved = [];
    const handler = createTicketCensusHandler({
      authenticate: async () => true,
      run: async () => ({state: 'stopped', reason: 'mhelp_ticket_access_denied', vendorReads: 1, rows: [], cursor: {budgetDay: null, runsToday: 1, readsToday: 1, statusOrdinal: 0, statusSeen: 0, statusBase: 0, statusBoundaryChecked: false, statusLastTicketId: null, recentSeen: 0, recentBase: 0, recentBoundaryChecked: false, recentLastTicketId: null, equipmentOrdinal: 0, equipmentSeen: 0, equipmentBase: 0, equipmentBoundaryChecked: false, equipmentLastTicketId: null, equipmentTruncated: false, equipmentSweepCount: 0}, recentTruncated: false, equipmentTruncated: false}),
      saveRows: async rows => { saved.push(rows); },
      saveCursor: async () => ({saved: true}),
      status: async () => ({censusRows: 0, cursor: null}),
    });
    const denied = await handler(new Request('https://census.example/run', {method: 'POST', headers: {'Content-Type': 'application/json'}, body: '{"action":"run"}'}));
    assert.equal(denied.status, 200);
    const body = await denied.json();
    assert.equal(body.reason, 'mhelp_ticket_access_denied');
    assert.equal(body.mhelpWrites, 0);
    assert.equal(body.jobCreates, 0);
    assert.equal(body.jobEdits, 0);
    assert.equal(saved.length, 0);
    assert.deepEqual(errors[0], ['ticket_census_stopped', 'mhelp_ticket_access_denied']);
    errors.length = 0;
    const truncated = createTicketCensusHandler({
      authenticate: async () => true,
      run: async () => ({state: 'completed', reason: null, vendorReads: 1, rows: [], cursor: emptyCursor(), recentTruncated: true, equipmentTruncated: false, flushed: true}),
      saveRows: async () => { throw new Error('should not save'); },
      saveCursor: async () => { throw new Error('should not save'); },
      status: async () => ({censusRows: 0, cursor: null}),
    });
    assert.equal((await truncated(new Request('https://census.example/run', {method: 'POST', headers: {'Content-Type': 'application/json'}, body: '{"action":"run"}'}))).status, 200);
    assert.deepEqual(errors[0], ['ticket_census_recent_truncated']);
    const failing = createTicketCensusHandler({
      authenticate: async () => true,
      run: async () => { throw new Error('synthetic failure'); },
      saveRows: async () => {},
      saveCursor: async () => {},
      status: async () => ({censusRows: 0}),
    });
    assert.equal((await failing(new Request('https://census.example/run', {method: 'POST', headers: {'Content-Type': 'application/json'}, body: '{"action":"run"}'}))).status, 503);
    assert.deepEqual(errors[1], ['ticket_census_failed', 'unclassified']);
    assert.equal((await handler(new Request('https://census.example/run?ticket=1', {method: 'POST', headers: {'Content-Type': 'application/json'}, body: '{"action":"run"}'}))).status, 405);
    assert.equal((await handler(new Request('https://census.example/run', {method: 'PUT', headers: {'Content-Type': 'application/json'}, body: '{"action":"run"}'}))).status, 405);
    assert.equal((await handler(new Request('https://census.example/run', {method: 'POST', headers: {'Content-Type': 'application/json'}, body: '{"action":"run","ticketId":"10"}'}))).status, 400);
  } finally { console.error = original; }
});

test('private census SQL is service-role only and matches a normalized equipment id', async () => {
  const db = new PGlite();
  try {
    await db.exec(`create schema if not exists cos_mhelp_placement_private;
      create table cos_mhelp_placement_private.links(equipment_id text primary key);
      insert into cos_mhelp_placement_private.links values ('1001'), ('1002'), ('A1001');
      drop schema if exists auth cascade; create schema auth;
      create function auth.role() returns text language sql stable as $$select nullif(current_setting('request.jwt.claim.role', true), '')$$;
      do $$ begin
        if not exists(select 1 from pg_roles where rolname='anon') then create role anon; end if;
        if not exists(select 1 from pg_roles where rolname='authenticated') then create role authenticated; end if;
        if not exists(select 1 from pg_roles where rolname='service_role') then create role service_role bypassrls; end if;
      end $$;`);
    await db.exec(await readFile(new URL('../db/cos-mhelp-ticket-census.sql', import.meta.url), 'utf8'));
    const call = (sql, params = []) => db.transaction(async tx => {
      await tx.exec('set local role service_role');
      await tx.query("select set_config('request.jwt.claim.role','service_role',true)");
      return tx.query(sql, params);
    });
    const row = {ticketId: '10', ticketNumber: '100', customerName: 'Synthetic Yard', status: 'New', type: 'Install', createdAt: '2026-11-18T15:00:00.000Z', scheduledAt: '2026-11-19T15:00:00.000Z', equipmentId: '1001'};
    assert.equal((await call('select public.cos_mhelp_census_ticket_upsert($1::jsonb) result', [JSON.stringify([row])])).rows[0].result.stored, 1);
    assert.equal((await call('select public.cos_mhelp_census_ticket_upsert($1::jsonb) result', [JSON.stringify([{...row, customerName: null, equipmentId: null, status: 'Scheduled'}])])).rows[0].result.stored, 1);
    const match = (await call('select public.cos_mhelp_census_ticket_duplicates($1) result', ['1001'])).rows[0].result;
    assert.equal(match.rows.length, 1);
    assert.equal(match.rows[0].customerName, 'Synthetic Yard');
    assert.equal(match.rows[0].equipmentId, '1001');
    assert.equal(match.rows[0].status, 'Scheduled');
    assert.equal(Object.hasOwn(match.rows[0], 'notes'), false);
    await assert.rejects(call('select public.cos_mhelp_census_ticket_duplicates($1)', ['A1001']));
    await assert.rejects(call('select public.cos_mhelp_census_ticket_upsert($1::jsonb)', [JSON.stringify([{...row, notes: 'drop-me-note'}])]));
    const equipment = (await call('select public.cos_mhelp_census_ticket_equipment(0) result')).rows[0].result;
    assert.deepEqual(equipment.equipmentIds, ['1001', '1002']);
    const cursor = (await call("select public.cos_mhelp_census_ticket_cursor('read', null) result")).rows[0].result;
    assert.equal(cursor.censusRows, 1);
    assert.equal(cursor.cursor.equipmentOrdinal, 0);
    const advanced = (await call("select public.cos_mhelp_census_ticket_cursor('save', $1::jsonb) result", [JSON.stringify({...cursor.cursor, equipmentOrdinal: 2})])).rows[0].result;
    assert.equal(advanced.cursor.equipmentOrdinal, 2);
    await assert.rejects(call("select public.cos_mhelp_census_ticket_cursor('save', $1::jsonb)", [JSON.stringify({...cursor.cursor, note: 'drop-me-note'})]));
    const security = (await db.query(`select c.relrowsecurity, c.relforcerowsecurity,
      (select count(*) from pg_policy p where p.polrelid=c.oid) policies,
      has_table_privilege('anon','cos_mhelp_placement_private.census_mhelp_ticket','select') anon_select,
      has_table_privilege('authenticated','cos_mhelp_placement_private.census_mhelp_ticket','select') auth_select,
      has_table_privilege('service_role','cos_mhelp_placement_private.census_mhelp_ticket','select') service_select
      from pg_class c join pg_namespace n on n.oid=c.relnamespace
      where n.nspname='cos_mhelp_placement_private' and c.relname='census_mhelp_ticket'`)).rows[0];
    assert.equal(security.relrowsecurity, true);
    assert.equal(Number(security.policies), 0);
    assert.equal(security.anon_select, false);
    assert.equal(security.auth_select, false);
    assert.equal(security.service_select, false);
    await db.transaction(async tx => {
      await tx.exec('set local role authenticated');
      await tx.query("select set_config('request.jwt.claim.role','authenticated',true)");
      await assert.rejects(tx.query('select public.cos_mhelp_census_ticket_duplicates($1)', ['1001']));
    });
  } finally { await db.close(); }
});

test('the sibling reuses the token manager and does not embed a credential', async () => {
  const source = await readFile(new URL('../../supabase/functions/cos-mhelp-ticket-census/serve.ts', import.meta.url), 'utf8');
  assert.match(source, /nativeMhelpTokens/);
  assert.match(source, /fetch: tokens\.fetch/);
  assert.equal(source.includes('connect.mhelpdesk.com'), false);
  assert.match(source, /assertTcpProject\(Deno\.env\.get\('SUPABASE_URL'\)\)/);
  assert.equal(source.includes('[a-z0-9]+\\.supabase\\.co'), false);
  assert.match(source, /goqrnolcvqnirjmzaeyk/);
  assert.equal(source.includes('COS_MHELP_ACCESS_TOKEN'), false);
  assert.equal(/Bearer [A-Za-z0-9_-]{20,}/.test(source), false);
});

test('upserts of more than 200 rows are chunked and the cursor is saved per chunk', async () => {
  const rows = Array.from({length: 250}, (_, index) => ({ticketId: String(index + 1), ticketNumber: String(index + 1), customerName: null, status: 'New', type: 'Install', createdAt: '2026-11-18T15:00:00.000Z', scheduledAt: null, equipmentId: null}));
  const saved = [], cursors = [];
  await assert.rejects(persistCensusChunk(rows, emptyCursor(), async chunk => {
    if (saved.length === 1) throw new Error('second chunk failed');
    assert.ok(chunk.length <= 200);
    saved.push(chunk.length);
  }, async () => { cursors.push(1); }));
  assert.deepEqual(saved, [200]);
  assert.equal(cursors.length, 1);
});

test('48 runs and 1152 ticket reads are enforced before another vendor call', async () => {
  const now = Date.parse('2026-11-18T18:00:00.000Z');
  const day = '2026-11-18';
  let calls = 0;
  const fetch = async () => { calls += 1; return json(statuses); };
  const cappedRuns = await readTicketCensus({fetch, portalId: String(portal), accessToken: 'synthetic-census-token', now: () => now, cursor: {...emptyCursor(), budgetDay: day, runsToday: TICKET_RUNS_PER_DAY}});
  assert.equal(cappedRuns.reason, 'daily_budget');
  assert.equal(calls, 0);
  assert.equal(cappedRuns.cursor.runsToday, TICKET_RUNS_PER_DAY);
  const cappedReads = await readTicketCensus({fetch, portalId: String(portal), accessToken: 'synthetic-census-token', now: () => now, cursor: {...emptyCursor(), budgetDay: day, readsToday: TICKET_DAILY_CAP}});
  assert.equal(cappedReads.reason, 'daily_budget');
  assert.equal(calls, 0);
  assert.equal(TICKET_DAILY_CAP, 1152);
  assert.equal(TICKET_RUN_CAP * TICKET_RUNS_PER_DAY, 1152);
});

test('a customer read keeps only the name and stays a GET inside the census allowlist', async () => {
  const dropped = {address1: 'drop-me-street', address2: 'drop-me-street', city: 'drop-me-city', state: 'TX', zip: '00000', primaryPhone: 'drop-me-phone', secondaryPhone: 'drop-me-phone', fax: 'drop-me-phone', email: 'drop-me-contact', notes: 'drop-me-note', contacts: [{name: 'drop-me-staff'}], latitude: 1, longitude: 2, fullAddress: 'drop-me-street'};
  const {fetch, calls} = vendor([ticket()], {customer: {...dropped, customerId: 20, portalId: portal, name: 'Synthetic Yard'}});
  const result = await readTicketCensus({fetch, portalId: String(portal), accessToken: 'synthetic-census-token', equipmentIds: [], now: () => Date.parse('2026-11-18T18:00:00.000Z')});
  const customerCall = calls.find(call => call.url.includes('/customers/'));
  assert.equal(customerCall.method, 'GET');
  assert.equal(new URL(customerCall.url).searchParams.get('Fields'), 'customerId,portalId,name');
  assert.equal(result.rows[0].customerName, 'Synthetic Yard');
  const body = JSON.stringify(result.rows);
  for (const value of ['drop-me-street', 'drop-me-city', 'drop-me-phone', 'drop-me-contact', 'drop-me-note', 'drop-me-staff', 'fullAddress', 'latitude']) assert.equal(body.includes(value), false, value);
});

test('equipment pages are newest first and truncation is explicit', async () => {
  const newest = Array.from({length: 300}, (_, index) => ticket({ticketId: 300 - index, ticketNumber: 300 - index, customerId: null}));
  const fetch = async (url, init = {}) => {
    assert.equal((init.method || 'GET'), 'GET');
    const parsed = new URL(url);
    if (parsed.pathname.endsWith('/ticketstatus')) return json(statuses);
    if (parsed.pathname.endsWith('/tickettypes')) return json(types);
    if (parsed.pathname.includes('/Equipment/')) {
      assert.equal(parsed.searchParams.get('sort'), '-ticketId');
      const rowIndex = parsed.searchParams.get('rowIndex');
      const start = rowIndex == null ? 0 : Number(rowIndex) - 1;
      return json({totalRows: newest.length, data: newest.slice(start, start + 50)});
    }
    return json({totalRows: 0, data: []});
  };
  const result = await readTicketCensus({fetch, portalId: String(portal), accessToken: 'synthetic-census-token', equipmentIds: ['1001', '1002'], now: () => Date.parse('2026-11-18T18:00:00.000Z')});
  assert.equal(result.equipmentTruncated, true);
  assert.equal(result.cursor.equipmentOrdinal, 0);
  assert.equal(result.rows.some(row => row.ticketId === '300' && row.equipmentId === '1001'), true);
  assert.equal(result.rows.some(row => row.ticketId === '1'), false);
});

test('known-open tickets older than 48 hours are refreshed and a closed status replaces the stale one', async () => {
  const calls = [];
  const fetch = async (url, init = {}) => {
    calls.push({url: String(url), method: init.method || 'GET'});
    const parsed = new URL(url);
    if (parsed.pathname.endsWith('/ticketstatus')) return json(statuses);
    if (parsed.pathname.endsWith('/tickettypes')) return json(types);
    if (parsed.pathname.endsWith('/Tickets/10')) return json(ticket({ticketId: 10, statusId: 2, ticketStatus: 'Complete', subject: 'drop-me-note', comment: 'drop-me-note', creationDate: '2026-10-01T15:00:00.000Z'}));
    if (parsed.pathname.endsWith('/Tickets/11')) return json({error: 'hidden'}, 404);
    return json({totalRows: 0, data: []});
  };
  const missing = [];
  const result = await readTicketCensus({fetch, portalId: String(portal), accessToken: 'synthetic-census-token', equipmentIds: [], refreshTicketIds: ['10', '11'], now: () => Date.parse('2026-11-18T18:00:00.000Z'), onMissingTicket: async id => { missing.push(id); }});
  const refreshed = result.rows.find(row => row.ticketId === '10');
  assert.equal(refreshed.status, 'Complete');
  assert.equal(JSON.stringify(refreshed).includes('drop-me-note'), false);
  assert.deepEqual(missing, ['11']);
  assert.equal(calls.every(call => call.method === 'GET'), true);
});

test('a later page failure keeps the cursor saved for the pages already stored', async () => {
  const saved = [];
  const rows = Array.from({length: 60}, (_, index) => ticket({ticketId: index + 1, ticketNumber: 1000 + index}));
  const {fetch} = vendor(rows);
  let pages = 0;
  await assert.rejects(readTicketCensus({
    fetch, portalId: String(portal), accessToken: 'synthetic-census-token', equipmentIds: [], now: () => Date.parse('2026-11-18T18:00:00.000Z'),
    onProgress: async (chunk, cursor) => {
      if (!chunk.length) return;
      pages += 1;
      saved.push({count: chunk.length, seen: cursor.statusSeen});
      if (pages === 2) throw new Error('page failed');
    },
  }));
  assert.equal(saved[0].count <= 200, true);
  assert.equal(saved[0].seen > 0, true);
});

test('applying the census SQL and its rollback returns the database to the starting catalog', async () => {
  const db = new PGlite();
  try {
    await db.exec(`create schema if not exists cos_mhelp_placement_private;
      create table cos_mhelp_placement_private.links(equipment_id text primary key);
      insert into cos_mhelp_placement_private.links values ('1001');
      drop schema if exists auth cascade; create schema auth;
      create function auth.role() returns text language sql stable as $$select nullif(current_setting('request.jwt.claim.role', true), '')$$;
      do $$ begin
        if not exists(select 1 from pg_roles where rolname='anon') then create role anon; end if;
        if not exists(select 1 from pg_roles where rolname='authenticated') then create role authenticated; end if;
        if not exists(select 1 from pg_roles where rolname='service_role') then create role service_role bypassrls; end if;
      end $$;`);
    const catalog = async () => ({
      tables: (await db.query(`select n.nspname, c.relname from pg_class c join pg_namespace n on n.oid=c.relnamespace where n.nspname in ('public','cos_mhelp_placement_private') and c.relkind='r' order by 1, 2`)).rows,
      functions: (await db.query(`select n.nspname, p.proname, pg_get_function_identity_arguments(p.oid) args from pg_proc p join pg_namespace n on n.oid=p.pronamespace where n.nspname in ('public','cos_mhelp_placement_private','auth') order by 1, 2, 3`)).rows,
      links: (await db.query('select equipment_id from cos_mhelp_placement_private.links order by 1')).rows,
    });
    const before = await catalog();
    await db.exec(await readFile(new URL('../db/cos-mhelp-ticket-census.sql', import.meta.url), 'utf8'));
    assert.equal((await db.query(`select count(*)::int n from pg_class c join pg_namespace n on n.oid=c.relnamespace where n.nspname='cos_mhelp_placement_private' and c.relname='census_mhelp_ticket'`)).rows[0].n, 1);
    await db.exec(await readFile(new URL('../db/cos-mhelp-ticket-census-rollback.sql', import.meta.url), 'utf8'));
    assert.deepEqual(await catalog(), before);
  } finally { await db.close(); }
});

test('SUPABASE_URL must be the TCP project or the census refuses to run', () => {
  assert.equal(assertTcpProject('https://tughscoxralhofrckvxy.supabase.co'), 'https://tughscoxralhofrckvxy.supabase.co');
  for (const url of [undefined, '', 'https://other.supabase.co', 'https://tughscoxralhofrckvxy.supabase.co.evil.test', 'http://tughscoxralhofrckvxy.supabase.co']) {
    assert.throws(() => assertTcpProject(url), error => error.message === 'Backend unavailable');
  }
});

test('a denied daily reservation is not followed by a vendor read', async () => {
  let fetches = 0;
  const stopped = await readTicketCensus({
    fetch: async () => { fetches += 1; return json(statuses); },
    portalId: String(portal), accessToken: 'synthetic-census-token', equipmentIds: [],
    claimRun: async () => ({allowed: false, runs: 48, reads: 10}),
    claimReads: async () => { throw new Error('read claimed after a denied run'); },
    now: () => Date.parse('2026-11-18T18:00:00.000Z'),
  });
  assert.equal(stopped.reason, 'daily_budget');
  assert.equal(fetches, 0);
  assert.equal(stopped.cursor.runsToday, 48);
  const deniedRead = await readTicketCensus({
    fetch: async () => { fetches += 1; return json(statuses); },
    portalId: String(portal), accessToken: 'synthetic-census-token', equipmentIds: [],
    claimRun: async () => ({allowed: true, runs: 1, reads: 1151}),
    claimReads: async () => ({allowed: false, runs: 1, reads: 1152}),
    now: () => Date.parse('2026-11-18T18:00:00.000Z'),
  });
  assert.equal(deniedRead.reason, 'daily_budget');
  assert.equal(fetches, 0);
});

test('an equipment page that ignores sort is skipped and the next unit is read', async () => {
  const fetch = async (url, init = {}) => {
    assert.equal(init.method || 'GET', 'GET');
    const parsed = new URL(url);
    if (parsed.pathname.endsWith('/ticketstatus')) return json(statuses);
    if (parsed.pathname.endsWith('/tickettypes')) return json(types);
    if (parsed.pathname.includes('/Equipment/1001/')) return json({totalRows: 3, data: [ticket({ticketId: 1, customerId: null}), ticket({ticketId: 2, customerId: null}), ticket({ticketId: 3, customerId: null})]});
    if (parsed.pathname.includes('/Equipment/1002/')) return json({totalRows: 1, data: [ticket({ticketId: 9, ticketNumber: 90, customerId: null})]});
    return json({totalRows: 0, data: []});
  };
  const result = await readTicketCensus({fetch, portalId: String(portal), accessToken: 'synthetic-census-token', equipmentIds: ['1001', '1002'], now: () => Date.parse('2026-11-18T18:00:00.000Z')});
  assert.equal(result.state, 'completed');
  assert.equal(result.equipmentSortUnverified, true);
  assert.equal(result.rows.some(row => row.equipmentId === '1001'), false);
  assert.equal(result.rows.some(row => row.ticketId === '9' && row.equipmentId === '1002'), true);
});

test('two parallel budget claims at 47 let only one run through, and a 404 becomes Unknown without a fresh check time', async () => {
  const db = new PGlite();
  try {
    await db.exec(`create schema if not exists cos_mhelp_placement_private;
      create table cos_mhelp_placement_private.links(equipment_id text primary key);
      drop schema if exists auth cascade; create schema auth;
      create function auth.role() returns text language sql stable as $$select nullif(current_setting('request.jwt.claim.role', true), '')$$;
      do $$ begin
        if not exists(select 1 from pg_roles where rolname='anon') then create role anon; end if;
        if not exists(select 1 from pg_roles where rolname='authenticated') then create role authenticated; end if;
        if not exists(select 1 from pg_roles where rolname='service_role') then create role service_role bypassrls; end if;
      end $$;`);
    await db.exec(await readFile(new URL('../db/cos-mhelp-ticket-census.sql', import.meta.url), 'utf8'));
    await db.exec(`insert into cos_mhelp_placement_private.census_mhelp_ticket_budget(utc_day, runs, reads) values ('2026-11-18', 47, 1151)`);
    const claim = () => db.transaction(async tx => {
      await tx.exec('set local role service_role');
      await tx.query("select set_config('request.jwt.claim.role','service_role',true)");
      return (await tx.query(`select public.cos_mhelp_census_ticket_claim_run('2026-11-18'::date) result`)).rows[0].result;
    });
    const claimed = await Promise.all([claim(), claim()]);
    assert.equal(claimed.filter(row => row.allowed === true).length, 1);
    assert.equal(claimed.filter(row => row.allowed === false).length, 1);
    assert.equal((await db.query('select runs, reads from cos_mhelp_placement_private.census_mhelp_ticket_budget')).rows[0].runs, 48);
    const readClaim = () => db.transaction(async tx => {
      await tx.exec('set local role service_role');
      await tx.query("select set_config('request.jwt.claim.role','service_role',true)");
      return (await tx.query(`select public.cos_mhelp_census_ticket_claim_reads('2026-11-18'::date, 1) result`)).rows[0].result;
    });
    const reads = await Promise.all([readClaim(), readClaim()]);
    assert.equal(reads.filter(row => row.allowed === true).length, 1);
    assert.equal((await db.query('select reads from cos_mhelp_placement_private.census_mhelp_ticket_budget')).rows[0].reads, 1152);
    await db.exec(`insert into cos_mhelp_placement_private.census_mhelp_ticket(ticket_id, ticket_number, status_label, type_label, created_at, equipment_id, fetched_at)
      values ('10','100','New','Install','2026-01-01T00:00:00Z','1001','2026-01-01T00:00:00Z'),
             ('12','120','New','Install','2026-01-02T00:00:00Z','1001','2026-01-02T00:00:00Z')`);
    const marked = await db.transaction(async tx => {
      await tx.exec('set local role service_role');
      await tx.query("select set_config('request.jwt.claim.role','service_role',true)");
      return (await tx.query(`select public.cos_mhelp_census_ticket_missing('10') result`)).rows[0].result;
    });
    assert.equal(marked.status, 'Unknown');
    const stored = (await db.query(`select status_label, fetched_at from cos_mhelp_placement_private.census_mhelp_ticket where ticket_id='10'`)).rows[0];
    assert.equal(stored.status_label, 'Unknown');
    assert.equal(new Date(stored.fetched_at).toISOString(), '2026-01-01T00:00:00.000Z');
    const refresh = await db.transaction(async tx => {
      await tx.exec('set local role service_role');
      await tx.query("select set_config('request.jwt.claim.role','service_role',true)");
      return (await tx.query(`select public.cos_mhelp_census_ticket_refresh(4) result`)).rows[0].result;
    });
    assert.deepEqual(refresh.ticketIds, ['12']);
  } finally { await db.close(); }
});
