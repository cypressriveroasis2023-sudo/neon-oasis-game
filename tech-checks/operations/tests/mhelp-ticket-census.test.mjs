import test from 'node:test';
import assert from 'node:assert/strict';
import {readFile} from 'node:fs/promises';
import {PGlite} from '@electric-sql/pglite';
import {assertCensusMethod, assertCensusPath, customerNamePath, ticketListPath} from '../../supabase/functions/cos-mhelp-ticket-census/allowlist.ts';
import {ticketBudgetPlan, censusBackoffMs, DATA_DAILY_CAP, INVENTORY_DAY_RESERVE, TICKET_RUN_CAP, TICKET_RUNS_PER_DAY} from '../../supabase/functions/cos-mhelp-ticket-census/budget.ts';
import {normalizeMhelpId, projectCensusTicket, closedStatusLabel} from '../../supabase/functions/cos-mhelp-ticket-census/project.ts';
import {readTicketCensus} from '../../supabase/functions/cos-mhelp-ticket-census/read.ts';
import {createTicketCensusHandler} from '../../supabase/functions/cos-mhelp-ticket-census/index.ts';

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
    if (parsed.pathname.includes('/customers/')) return json({customerId: 20, portalId: portal, name: 'Synthetic Yard', address1: 'drop-me-street', notes: 'drop-me-note', primaryPhone: 'drop-me-contact'});
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
  for (const path of ['/portal/224643/Tickets/10', '/portal/224643/Tickets?description=drop-me-note&pageSize=50&sort=ticketId', '/portal/224643/Tickets?pageSize=50&sort=ticketId', '/portal/224643/customers/20?Fields=customerId,portalId,name,address1', '/portal/224643/Equipment/20/Tickets?pageSize=50&sort=ticketId&fields=comment']) {
    assert.throws(() => assertCensusPath(path), error => error.message === 'mhelp_path_rejected');
  }
  assert.equal(customerNamePath('20'), '/portal/224643/customers/20?Fields=customerId,portalId,name');
  assert.doesNotThrow(() => assertCensusPath(ticketListPath({statusId: '0'}, null)));
});

test('census rows keep only the duplicate-check columns and the normalized A#', async () => {
  const rows = Array.from({length: 60}, (_, index) => ticket({ticketId: index + 1, ticketNumber: 1000 + index}));
  const {fetch, calls} = vendor(rows);
  let clock = Date.parse('2026-11-18T18:00:00.000Z');
  const result = await readTicketCensus({fetch, accessToken: 'synthetic-census-token', equipmentIds: ['1001', 'A1001', '01001'], now: () => clock, wait: async () => { throw new Error('unexpected wait'); }});
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
  assert.equal(result.cursor.equipmentOrdinal, 1);
});

test('a ticket read 401 or 403 stops the run without a retry', async () => {
  for (const status of [401, 403]) {
    const {fetch, calls} = vendor([], {fail: '/ticketstatus', status});
    const waits = [];
    const result = await readTicketCensus({fetch, accessToken: 'synthetic-census-token', wait: async ms => { waits.push(ms); }});
    assert.equal(result.state, 'stopped');
    assert.equal(result.reason, 'mhelp_ticket_access_denied');
    assert.equal(calls.length, 1);
    assert.equal(waits.length, 0);
    assert.equal(result.rows.length, 0);
  }
});

test('provider 429 waits with exponential backoff and a budget 429 does not retry', async () => {
  const calls = [];
  const waits = [];
  let now = Date.parse('2026-11-18T18:00:00.000Z');
  const fetch = async () => {
    calls.push(now);
    return json({error: 'hidden'}, 429, {'Retry-After': '9'});
  };
  const limited = await readTicketCensus({fetch, accessToken: 'synthetic-census-token', now: () => now, wait: async ms => { waits.push(ms); now += ms; }});
  assert.equal(limited.reason, 'mhelp_rate_limited');
  assert.deepEqual(waits, [9000, 9000]);
  assert.equal(calls.length, 3);
  const budgetCalls = [];
  const budget = await readTicketCensus({fetch: async () => { budgetCalls.push(1); return json({}, 429, {'X-COS-Mhelp-Budget': '1', 'Retry-After': '30'}); }, accessToken: 'synthetic-census-token', wait: async () => { throw new Error('budget retry'); }});
  assert.equal(budget.reason, 'daily_budget');
  assert.equal(budgetCalls.length, 1);
  const deferred = await readTicketCensus({fetch: async () => json({}, 429, {'X-COS-Mhelp-Deferred': '1'}), accessToken: 'synthetic-census-token', wait: async () => { throw new Error('deferred retry'); }});
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
  const disagreed = projectCensusTicket(ticket({equipmentId: 9999}), labels, '1001');
  assert.equal(disagreed.row.equipmentId, null);
  const fromPath = projectCensusTicket(ticket(), labels, '1001');
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
      run: async () => ({state: 'stopped', reason: 'mhelp_ticket_access_denied', vendorReads: 1, rows: [], cursor: {statusOrdinal: 0, statusSeen: 0, statusBase: 0, statusBoundaryChecked: false, statusLastTicketId: null, recentSeen: 0, recentBase: 0, recentBoundaryChecked: false, recentLastTicketId: null, equipmentOrdinal: 0}, recentTruncated: false}),
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
  assert.equal(source.includes('COS_MHELP_ACCESS_TOKEN'), false);
  assert.equal(/Bearer [A-Za-z0-9_-]{20,}/.test(source), false);
});
