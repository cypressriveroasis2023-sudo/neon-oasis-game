// COS Operations bridge: existing GitHub Tech Check identity -> same-person production Owner.
// No browser-supplied actor, organization, table, RPC name, service key, or identity provisioning.
const LEGACY_URL = 'https://goqrnolcvqnirjmzaeyk.supabase.co';
const LEGACY_PUBLISHABLE_KEY = 'sb_publishable__URX6fCOr6KVvGsUsGS7wA_a1AmU7Rw';
const ORGANIZATION_ID = 'ece6d2a2-fd19-4cc7-b56a-2fa004a6d8f5';
const OWNER_LINKS = Object.freeze({
  'e4abc521-1ef3-45a6-9829-b87faff78210': '3f073784-96e7-43d8-b9e0-33ab31c3c8b1',
});
const ALLOWED_ORIGIN = 'https://cypressriveroasis2023-sudo.github.io';
const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;
class HttpError extends Error {
  constructor(message, status = 400) { super(message); this.status = status; }
}
const fail = (message, status = 400) => { throw new HttpError(message, status); };
function textValue(value, label, required = false, max = 4000) {
  if (value == null && !required) return null;
  if (typeof value !== 'string') fail(label + ' must be text.');
  const result = value.trim();
  if (required && !result) fail(label + ' is required.');
  if (result.length > max) fail(label + ' is too long.');
  return result || null;
}
function idValue(value, label, required = true) {
  if (!required && (value == null || value === '')) return null;
  if (typeof value !== 'string' || !UUID.test(value)) fail(label + ' must be a valid identifier.');
  return value.toLowerCase();
}
function localTime(value) {
  if (typeof value !== 'string') return null;
  const match = /^(\d{4})-(\d{2})-(\d{2})[ T](\d{2}):(\d{2})$/.exec(value.trim());
  if (!match) return null;
  const [, yy, mm, dd, hh, mi] = match;
  const y = Number(yy), m = Number(mm), d = Number(dd), h = Number(hh), i = Number(mi);
  const leap = y % 4 === 0 && (y % 100 !== 0 || y % 400 === 0);
  const days = [31, leap ? 29 : 28, 31, 30, 31, 30, 31, 31, 30, 31, 30, 31];
  if (y < 1 || m < 1 || m > 12 || d < 1 || d > days[m - 1] || h > 23 || i > 59) return null;
  return yy + '-' + mm + '-' + dd + ' ' + hh + ':' + mi;
}
function schedule(body, optional = false) {
  const absent = v => v == null || (typeof v === 'string' && !v.trim());
  if (optional && absent(body.start) && absent(body.end)) return { start: null, end: null };
  const start = localTime(body.start), end = localTime(body.end);
  if (!start || !end) fail('Enter valid start and end dates in YYYY-MM-DD HH:MM format.');
  if (end <= start) fail('End time must be after start time.');
  return { start, end };
}
async function requestBody(request) {
  if (!/^application\/json(?:;|$)/i.test(request.headers.get('Content-Type') || '')) fail('Use an application/json request body.', 415);
  if (Number(request.headers.get('Content-Length')) > 65536) fail('Request body is too large.', 413);
  const raw = await request.text();
  if (raw.length > 65536) fail('Request body is too large.', 413);
  let body;
  try { body = JSON.parse(raw); } catch { fail('A valid JSON request body is required.'); }
  if (!body || typeof body !== 'object' || Array.isArray(body)) fail('A JSON object is required.');
  return body;
}
function gps(body) {
  const allowed = new Set(['latitude', 'longitude', 'accuracyM', 'source', 'note']);
  if (Object.keys(body).some(k => !allowed.has(k))) fail('GPS request contains unsupported fields.');
  const finite = (v, label) => {
    if (typeof v !== 'number' || !Number.isFinite(v)) fail(label + ' is required and must be a finite number.');
    return v;
  };
  const latitude = finite(body.latitude, 'Latitude'), longitude = finite(body.longitude, 'Longitude');
  if (latitude < -90 || latitude > 90) fail('Latitude must be between -90 and 90.');
  if (longitude < -180 || longitude > 180) fail('Longitude must be between -180 and 180.');
  const accuracyM = body.accuracyM == null ? null : finite(body.accuracyM, 'GPS accuracy');
  if (accuracyM !== null && accuracyM < 0) fail('GPS accuracy must be zero or greater.');
  const source = (textValue(body.source, 'GPS source') || 'manual').toLowerCase();
  if (!['manual', 'device_gps', 'phone_gps', 'site', 'router', 'import'].includes(source)) fail('Unsupported GPS source.');
  return { latitude, longitude, accuracyM, source, note: textValue(body.note, 'GPS note') };
}

/** Dependencies can be injected for meaningful authentication/contract regression tests. */
export function createOperationsHandler(options) {
  const requestFetch = options.fetch || fetch;
  const serviceKey = options.serviceKey;
  const platformUrl = options.platformUrl;
  const readJson = async (url, init, fallback) => {
    let response;
    try { response = await requestFetch(url, init); }
    catch { fail(fallback, 503); }
    let data;
    try { data = await response.json(); } catch { data = {}; }
    if (!response.ok) {
      if (response.status >= 500) fail(fallback, 503);
      const message = typeof data.message === 'string' ? data.message : fallback;
      fail(message, response.status === 401 || response.status === 403 ? response.status : 409);
    }
    return data;
  };
  const platformHeaders = () => ({
    apikey: serviceKey, Authorization: 'Bearer ' + serviceKey,
    Accept: 'application/json', 'Content-Type': 'application/json',
  });
  const platformRead = path => readJson(platformUrl + '/rest/v1/' + path, {
    headers: platformHeaders(),
  }, 'COS production data is unavailable. Please retry.');
  const platformAll = async path => {
    const items = [];
    for (let offset = 0; offset < 100000; offset += 1000) {
      const page = await platformRead(path + '&limit=1000&offset=' + offset);
      if (!Array.isArray(page)) fail('COS production returned an invalid collection.', 503);
      items.push(...page);
      if (page.length < 1000) return items;
    }
    fail('COS production collection exceeds the supported page limit.', 503);
  };
  const rpc = (name, payload) => readJson(platformUrl + '/rest/v1/rpc/' + name, {
    method: 'POST', headers: platformHeaders(), body: JSON.stringify(payload),
  }, 'COS workflow could not be completed. Please retry.');
  const authenticate = async request => {
    const authorization = request.headers.get('Authorization') || '';
    if (!/^Bearer [^\s]+$/i.test(authorization) || authorization.length > 8192) fail('Sign in to Tech Check to continue.', 401);
    const headers = { apikey: LEGACY_PUBLISHABLE_KEY, Authorization: authorization, Accept: 'application/json' };
    let user;
    try { user = await readJson(LEGACY_URL + '/auth/v1/user', { headers }, 'Your sign-in could not be verified.'); }
    catch (cause) {
      if (cause.status === 503) throw cause;
      fail('Your sign-in has expired. Sign in again.', 401);
    }
    if (!user || typeof user.id !== 'string' || !UUID.test(user.id)) fail('A verified Tech Check account is required.', 401);
    const profiles = await readJson(LEGACY_URL + '/rest/v1/profiles?select=user_id,full_name,role,active,archived_at&user_id=eq.' + user.id + '&limit=1', { headers }, 'Tech Check account access could not be verified.');
    const profile = Array.isArray(profiles) ? profiles[0] : null;
    if (!profile || profile.user_id !== user.id || profile.role !== 'owner' || profile.active !== true || profile.archived_at) fail('An active COS Owner account is required.', 403);
    const actorId = OWNER_LINKS[user.id.toLowerCase()];
    const context = { legacyId: user.id, name: profile.full_name || 'Owner', authorization, headers, actorId };
    if (!actorId) return context;
    if (!serviceKey || !platformUrl) fail('The COS production connection is not configured.', 503);
    const actors = await platformRead('user_profiles?select=user_id,active,department&organization_id=eq.' + ORGANIZATION_ID + '&user_id=eq.' + actorId + '&limit=1');
    const actor = Array.isArray(actors) ? actors[0] : null;
    if (!actor || actor.active !== true || actor.department !== 'owner') fail('Your linked COS production Owner account is inactive.', 403);
    const roles = await platformRead('user_roles?select=role_id,roles!inner(code,organization_id)&user_id=eq.' + actorId + '&roles.organization_id=eq.' + ORGANIZATION_ID + '&roles.code=eq.owner&limit=1');
    if (!Array.isArray(roles) || !roles.length) fail('Your linked COS production Owner role is not active.', 403);
    return context;
  };
  const assertRecord = async (table, id, fields = 'id') => {
    const records = await platformRead(table + '?select=' + fields + '&organization_id=eq.' + ORGANIZATION_ID + '&id=eq.' + id + '&limit=1');
    if (!Array.isArray(records) || !records.length) fail('COS record not found.', 404);
    return records[0];
  };
  const legacyAll = async (path, headers) => {
    const items = [];
    for (let offset = 0; offset < 100000; offset += 1000) {
      const rows = await readJson(LEGACY_URL + '/rest/v1/' + path + '&limit=1000&offset=' + offset, { headers }, 'Camera Health could not be loaded.');
      if (!Array.isArray(rows)) fail('Camera Health returned an invalid collection.', 503);
      items.push(...rows);
      if (rows.length < 1000) return items;
    }
    fail('Camera Health collection exceeds the supported page limit.', 503);
  };
  return async request => {
    const origin = request.headers.get('Origin');
    const cors = {
      'Access-Control-Allow-Origin': ALLOWED_ORIGIN,
      'Access-Control-Allow-Methods': 'GET, POST, OPTIONS',
      'Access-Control-Allow-Headers': 'authorization, apikey, content-type, x-client-info',
      'Access-Control-Max-Age': '600',
      'Vary': 'Origin',
      'Cache-Control': 'no-store',
      'Content-Type': 'application/json',
      'X-Content-Type-Options': 'nosniff',
    };
    const json = (body, status = 200) => new Response(JSON.stringify(body), { status, headers: cors });
    if (origin && origin !== ALLOWED_ORIGIN) return json({ error: 'This origin is not allowed.' }, 403);
    if (request.method === 'OPTIONS') return new Response(null, { status: 204, headers: cors });
    try {
      if (!['GET', 'POST'].includes(request.method)) fail('Method not supported.', 405);
      let path = new URL(request.url).pathname.replace(/^.*\/cos-operations-(?:pages|bridge)(?=\/|$)/, '').replace(/\/$/, '');
      let method = request.method, body = null;
      const context = await authenticate(request);
      if (!path && request.method === 'POST') {
        const envelope = await requestBody(request);
        if (Object.keys(envelope).some(k => !['path', 'method', 'body'].includes(k))) fail('Unsupported transport fields.');
        if (typeof envelope.path !== 'string' || !/^\/api\/[a-zA-Z0-9/_-]+$/.test(envelope.path)) fail('COS endpoint not found.', 404);
        if (!['GET', 'POST'].includes(envelope.method)) fail('Method not supported.', 405);
        path = envelope.path.replace(/\/$/, '');
        method = envelope.method;
        body = envelope.body == null ? {} : envelope.body;
        if (!body || typeof body !== 'object' || Array.isArray(body)) fail('A JSON object is required.');
        if (method === 'GET' && Object.keys(body).length) fail('GET endpoints do not accept a request body.');
      }
      if (!path.startsWith('/api/')) fail('COS endpoint not found.', 404);
      if (method === 'GET' && path === '/api/session') return json({
        authorized: Boolean(context.actorId), legacyOwner: true, role: 'Owner', name: context.name,
        productionOwnerUserId: context.actorId || null,
        reason: context.actorId ? null : 'This Owner account is not linked to a COS production identity. Your existing Tech Check tools remain available.',
      });
      if (!context.actorId) fail('This Owner account is not linked to COS production. Use the existing Tech Check tools.', 403);
      const actorPayload = { p_actor_user_id: context.actorId, p_organization_id: ORGANIZATION_ID };
      if (method === 'GET') {
        const snapshots = {
          '/api/jobs': 'appdeploy_owner_jobs_snapshot',
          '/api/daily-board': 'cos_daily_board_snapshot',
          '/api/field-map': 'appdeploy_field_map_snapshot',
          '/api/owner-tasks': 'appdeploy_owner_tasks_snapshot',
          '/api/ar': 'appdeploy_invoices_snapshot',
          '/api/purchasing': 'appdeploy_purchasing_snapshot',
          '/api/financial-summary': 'appdeploy_financial_summary',
          '/api/sites': 'appdeploy_sites_snapshot',
          '/api/owner-review': 'appdeploy_owner_review_snapshot',
          '/api/owner-review/signatures': 'appdeploy_owner_review_signatures_snapshot',
        };
        if (snapshots[path]) return json(await rpc(snapshots[path], actorPayload));
        if (path === '/api/team-production') {
          const members = await platformRead('user_profiles?select=user_id,display_name,department,active&organization_id=eq.' + ORGANIZATION_ID + '&active=eq.true&department=in.(it,service)&order=display_name.asc');
          return json({ items: members.map(m => ({ userId: m.user_id, displayName: m.display_name, department: m.department, active: m.active, linked: true })) });
        }
        if (path === '/api/owner/control-data') {
          const [sites, truckChecks, team] = await Promise.all([
            platformAll('sites?select=id,name,customer_id,customers(name)&organization_id=eq.' + ORGANIZATION_ID + '&status=eq.active&order=name.asc'),
            rpc('appdeploy_owner_truck_checks_snapshot', actorPayload),
            platformRead('user_profiles?select=display_name,department&organization_id=eq.' + ORGANIZATION_ID + '&active=eq.true&department=in.(it,service)&order=display_name.asc'),
          ]);
          return json({ sites, truckChecks: truckChecks.items || [], serviceTechnicians: team.filter(t => t.department === 'service').map(t => t.display_name), itTechnicians: team.filter(t => t.department === 'it').map(t => t.display_name) });
        }
        if (path === '/api/quotes') {
          const rows = await platformAll('quotes?select=id,quote_number,current_version,status,issue_date,valid_until,created_at,customers(name),sites(name),quote_versions(version_number,status,total,notes,title,scope,discount_total,tax_total),jobs(job_number)&organization_id=eq.' + ORGANIZATION_ID + '&order=quote_number.asc');
          const statuses = { draft: 'Draft', review: 'Pending Owner Approval', approved: 'Owner Approved', sent: 'Sent', accepted: 'Customer Accepted', declined: 'Customer Declined', changes_requested: 'Customer Changes Requested', returned: 'Returned by Owner' };
          return json({ items: rows.map(r => {
            const v = (r.quote_versions || []).find(q => Number(q.version_number) === Number(r.current_version)) || r.quote_versions?.[0];
            const job = Array.isArray(r.jobs) ? r.jobs[0] : r.jobs;
            return { id: r.id, quoteNumber: r.quote_number, customer: r.customers?.name || '', site: r.sites?.name || '', title: v?.title || '', description: v?.scope || v?.notes || '', amount: Number(v?.total || 0), discountTotal: Number(v?.discount_total || 0), taxTotal: Number(v?.tax_total || 0), issueDate: r.issue_date, validUntil: r.valid_until, status: statuses[r.status] || r.status, locked: r.status !== 'draft', revision: Number(r.current_version) || 1, jobNumber: job?.job_number, activity: ['Production record · Supabase system of record'] };
          }) });
        }
        if (path === '/api/camera-health/summary') {
          const [devices, health] = await Promise.all([
            legacyAll('camera_devices?select=id,device_name,device_type,organization,unit_key,source_status,source_last_seen_at,last_health_checked_at,activation_state&order=id.asc', context.headers),
            legacyAll('camera_health_current?select=camera_device_id,overall_status,confirmed_outage&order=camera_device_id.asc', context.headers),
          ]);
          const shopIds = new Set(devices.filter(d => ['root', 'shop'].includes(String(d.organization || '').trim().toLowerCase())).map(d => d.id));
          const byId = new Map(health.map(h => [h.camera_device_id, h]));
          const rows = devices.filter(d => !shopIds.has(d.id)).map(d => {
            const h = byId.get(d.id) || {}, raw = String(h.overall_status || d.source_status || 'unknown').toLowerCase();
            const status = h.confirmed_outage === true || raw === 'offline' ? 'offline' : raw === 'online' ? 'online' : 'review';
            return { id: d.id, name: d.device_name || d.unit_key || ('Camera ' + d.id), unit: d.unit_key || '', type: d.device_type || '', organization: d.organization || '', status, checkedAt: d.source_last_seen_at || d.last_health_checked_at || null };
          }).sort((a, b) => a.name.localeCompare(b.name));
          return json({ totalDevices: devices.length, healthRows: health.length, fieldDevices: rows.length, shopRoot: shopIds.size, online: rows.filter(r => r.status === 'online').length, offline: rows.filter(r => r.status === 'offline').length, review: rows.filter(r => r.status === 'review').length, rows, refreshedAt: new Date().toISOString(), source: 'Camera Health' });
        }
        const history = /^\/api\/field-map\/([^/]+)\/history$/.exec(path);
        if (history) {
          const id = idValue(history[1], 'Unit');
          await assertRecord('equipment_units', id);
          return json(await rpc('appdeploy_unit_location_history', { p_actor_user_id: context.actorId, p_unit_id: id }));
        }
        fail('COS endpoint not found.', 404);
      }
      if (!body) body = await requestBody(request);
      if (['p_actor_user_id', 'actorId', 'organizationId', 'p_organization_id'].some(k => k in body)) fail('Caller identity and organization are determined by sign-in.');
      const gpsRoute = /^\/api\/field-map\/([^/]+)\/gps$/.exec(path);
      if (gpsRoute) {
        const id = idValue(gpsRoute[1], 'Unit'), input = gps(body);
        await assertRecord('equipment_units', id);
        return json(await rpc('appdeploy_set_unit_gps', { p_actor_user_id: context.actorId, p_unit_id: id, p_latitude: input.latitude, p_longitude: input.longitude, p_accuracy_m: input.accuracyM, p_source: input.source, p_note: input.note }));
      }
      if (path === '/api/owner-tasks') {
        const allowed = new Set(['id', 'title', 'instructions', 'priority', 'assignedUserId', 'assignedDepartment', 'relatedJobId', 'relatedSiteId', 'dueAt', 'ownerNotes']);
        if (Object.keys(body).some(k => !allowed.has(k))) fail('Task request contains unsupported fields.');
        const id = idValue(body.id, 'Task', false);
        const priority = textValue(body.priority, 'Priority') || 'medium';
        if (!['high', 'medium', 'low'].includes(priority)) fail('Priority must be high, medium or low.');
        const dueAt = textValue(body.dueAt, 'Due date', false, 100);
        if (dueAt && (!/^\d{4}-\d{2}-\d{2}T/.test(dueAt) || !Number.isFinite(Date.parse(dueAt)))) fail('Due date must be a valid ISO timestamp.');
        if (id) await assertRecord('owner_tasks', id);
        const payload = { title: textValue(body.title, 'Task title', true, 180), instructions: textValue(body.instructions, 'Task instructions', false, 12000), priority, assignedUserId: idValue(body.assignedUserId, 'Technician', false), assignedDepartment: textValue(body.assignedDepartment, 'Department'), relatedJobId: idValue(body.relatedJobId, 'Job', false), relatedSiteId: idValue(body.relatedSiteId, 'Site', false), dueAt, ownerNotes: textValue(body.ownerNotes, 'Owner notes', false, 12000) };
        return json(await rpc('appdeploy_save_owner_task', { ...actorPayload, p_task_id: id, p_payload: payload }), id ? 200 : 201);
      }
      if (path === '/api/owner/jobs/manual') {
        const id = idValue(body.siteId, 'Site');
        await assertRecord('sites', id);
        const jobType = (textValue(body.jobType, 'Job type', true) || '').toUpperCase();
        if (!['DELIVERY', 'SWAP', 'PICKUP', 'SERVICE'].includes(jobType)) fail('Choose Delivery, Swap, Pickup or Service.');
        const priority = textValue(body.priority, 'Priority') || 'normal';
        if (!['low', 'normal', 'high', 'urgent'].includes(priority)) fail('Choose a valid priority.');
        if (body.shopPrep != null && typeof body.shopPrep !== 'boolean') fail('Shop prep must be true or false.');
        return json(await rpc('appdeploy_owner_create_manual_job', { p_actor_user_id: context.actorId, p_site_id: id, p_job_type: jobType, p_title: textValue(body.title, 'Title', true, 250), p_description: textValue(body.description, 'Description', false, 12000), p_priority: priority, p_requires_shop_prep: body.shopPrep === true }), 201);
      }
      const truck = /^\/api\/owner\/truck-checks\/([^/]+)\/approve$/.exec(path);
      if (truck) {
        const id = idValue(truck[1], 'Truck check');
        await assertRecord('truck_checks', id);
        return json(await rpc('appdeploy_owner_approve_truck_stock', { p_actor_user_id: context.actorId, p_check_id: id, p_note: textValue(body.note, 'Owner note') }));
      }
      const advance = /^\/api\/owner\/jobs\/([^/]+)\/advance-it$/.exec(path);
      if (advance) {
        const id = idValue(advance[1], 'Job'), s = schedule(body, true);
        await assertRecord('jobs', id);
        return json(await rpc('appdeploy_owner_advance_it_to_service', { p_actor_user_id: context.actorId, p_job_id: id, p_note: textValue(body.note, 'Owner note'), p_unit_number: textValue(body.unitNumber, 'Unit number'), p_service_technician_name: textValue(body.serviceTechnician, 'Technician'), p_start_local: s.start, p_end_local: s.end }));
      }
      const job = /^\/api\/jobs\/([^/]+)\/(schedule|assign|dispatch|close|remove|owner-review)$/.exec(path);
      if (job) {
        const id = idValue(job[1], 'Job'), payload = { p_actor_user_id: context.actorId, p_job_id: id };
        const record = await assertRecord('jobs', id, job[2] === 'remove' ? 'id,job_number' : 'id');
        if (job[2] === 'schedule') {
          const s = schedule(body);
          return json(await rpc('appdeploy_schedule_current_visit', { ...payload, p_start_local: s.start, p_end_local: s.end, p_technician_name: textValue(body.technician, 'Technician', true, 160) }));
        }
        if (job[2] === 'assign') return json(await rpc('appdeploy_assign_current_visit', { ...payload, p_technician_name: textValue(body.technician, 'Technician', true, 160) }));
        if (job[2] === 'dispatch') return json(await rpc('appdeploy_dispatch_current_visit', payload));
        if (job[2] === 'remove') {
          const confirmation = textValue(body.confirmation, 'Removal confirmation', true, 160);
          if (confirmation !== 'DELETE ' + record.job_number) fail('Type DELETE followed by the exact COS Job number.');
          return json(await rpc('appdeploy_owner_delete_job', { ...payload, p_confirmation: confirmation }));
        }
        if (job[2] === 'close') return json(await rpc('appdeploy_owner_close_job', { ...payload, p_reason: textValue(body.reason, 'Reason') }));
        if (body.action === 'approve') return json(await rpc('appdeploy_owner_approve_job_for_billing', { ...payload, p_notes: null }));
        if (body.action === 'return') return json(await rpc('appdeploy_owner_return_job_for_correction', { ...payload, p_reason: textValue(body.reason, 'Return reason', true) }));
        fail('Owner Review action must be approve or return.');
      }
      fail('COS endpoint not found.', 404);
    } catch (cause) {
      const status = cause instanceof HttpError ? cause.status : 503;
      return json({ error: cause instanceof HttpError ? cause.message : 'COS Operations is unavailable. Please retry.' }, status);
    }
  };
}

if (typeof Deno !== 'undefined' && import.meta.main) {
  Deno.serve(createOperationsHandler({
    platformUrl: Deno.env.get('SUPABASE_URL'),
    serviceKey: Deno.env.get('SUPABASE_SERVICE_ROLE_KEY'),
  }));
}
