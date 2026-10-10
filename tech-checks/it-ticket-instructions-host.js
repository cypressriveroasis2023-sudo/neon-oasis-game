// Read-only original instructions beside protected IT and Service ticket entry.
// Service Home discovers ticket numbers through the existing read-only queue.
// The legacy workflow owns every claim, start, selection and handoff action.
const context = () => window.TechCheckContext;
let authObserved = false, authSubject, revision = 0, current = null;
let panel = null, content = null, refresh = null, toggle = null, controller = null;
let closed = false, pageActive = true;
let queueCurrent = null, queuePanel = null, queueContent = null, queueRefresh = null;
let queueRevision = 0, queueController = null;
const cleanTicket = value => typeof value === 'string' ? value.trim().replace(/^#\s*/, '') : '';
const validTicket = value => typeof value === 'string' && value.length > 0 && value.length <= 128 &&
  value === cleanTicket(value) && !/[\r\n]/.test(value);
const visible = node => Boolean(node?.isConnected && node.getClientRects().length);
function identity() {
  const c = context(), id = c?.getSession()?.user?.id, profile = c?.getProfile(), role = c?.getRole();
  return pageActive && id && ['it', 'service'].includes(role) && c?.getEffectiveRole() === role &&
    profile?.user_id === id && profile.active === true && !profile.archived_at &&
    (authSubject === undefined || authSubject === id) &&
    !document.body.classList.contains('owner-test-role-preview') &&
    visible(document.getElementById('appView')) &&
    visible(document.getElementById(role === 'it' ? 'view-it' : 'view-svc')) ? { subject: id, role } : null;
}
function selection() {
  const actor = identity();
  if (!actor) return null;
  const { subject, role } = actor;
  if (role === 'service') {
    // Only this exact pre-start contract identifies the protected Service ticket.
    // Later field/return/handoff screens cannot inherit a previous lookup.
    const msg = document.getElementById('wlServiceJobSearchMsg');
    const input = document.getElementById('wlServiceJobSearch');
    if (!visible(msg) || !visible(input)) return null;
    const found = msg.querySelectorAll(':scope > .wl-service-ticket-found');
    if (found.length !== 1 || !visible(found[0])) return null;
    const labels = found[0].querySelectorAll(':scope > .wl-service-ticket-number');
    const sites = found[0].querySelectorAll(':scope > .wl-service-ticket-site');
    if (labels.length !== 1 || sites.length !== 1 || !visible(labels[0]) || !visible(sites[0])) return null;
    const match = /^#([^\r\n]{1,128})$/.exec(labels[0].textContent);
    if (!match || !match[1].trim() || match[1] !== cleanTicket(match[1]) || match[1] !== cleanTicket(input.value)) return null;
    return { subject, role, ticket: match[1], anchor: sites[0], mode: 'lookup' };
  }
  const wizard = document.getElementById('wlItWizardOnly');
  if (visible(wizard)) {
    // Contract: protected progress() renders activeItPrep.ticket_no only in this
    // direct header child. Never scrape body text or carry a previous ticket.
    const heads = wizard.querySelectorAll(':scope > .wl-head');
    const labels = wizard.querySelectorAll(':scope > .wl-head > .small');
    if (heads.length !== 1 || labels.length !== 1 || !visible(labels[0])) return null;
    const match = /^MHelpDesk Ticket #([^\r\n]{1,128})$/.exec(labels[0].textContent);
    if (!match || !match[1].trim() || match[1] !== cleanTicket(match[1])) return null;
    return { subject, role, ticket: match[1], anchor: heads[0], mode: 'prep' };
  }
  const found = document.querySelector('#wlITJobSearchMsg .wl-it-ticket-found');
  if (visible(found) && found.querySelector('.wl-it-job-type')) {
    const ticket = cleanTicket(found.querySelector('.wl-it-ticket-number')?.textContent);
    if (validTicket(ticket) && ticket === cleanTicket(document.getElementById('wlITJobSearch')?.value))
      return { subject, role, ticket, anchor: found.querySelector('.wl-it-job-type'), mode: 'lookup' };
  }
  const input = document.getElementById('itTicket'), card = input?.closest('.card');
  const head = card?.querySelector('#wlCreateHead');
  // A hidden stale ticket input is not evidence of the current per-unit wizard.
  if (visible(card) && visible(head) && visible(card.querySelector('#wlCreateNav'))) {
    const ticket = cleanTicket(input.value);
    if (validTicket(ticket)) return { subject, role, ticket, anchor: head, mode: 'setup' };
  }
  return null;
}
function same(a, b) {
  return Boolean(a && b && a.subject === b.subject && a.role === b.role && a.ticket === b.ticket && a.anchor === b.anchor && a.mode === b.mode);
}
function text(tag, value) {
  const node = document.createElement(tag); node.textContent = value; return node;
}
function cancelRead() { revision++; controller?.abort(); controller = null; }
function clear() {
  cancelRead(); panel?.remove(); panel = content = refresh = toggle = null; current = null; closed = false;
}
function status(message, error = false) {
  const node = text('p', message); node.setAttribute('role', error ? 'alert' : 'status');
  content.replaceChildren(node);
}
function field(label, value) {
  const section = document.createElement('div');
  section.append(text('h4', label));
  const body = text('p', value); body.style.cssText = 'white-space:pre-wrap;overflow-wrap:anywhere;margin:6px 0 14px;';
  section.append(body); return section;
}
async function load() {
  const selected = current;
  if (closed || !same(selected, selection())) { present(); return; }
  cancelRead(); const request = revision;
  const pending = new AbortController(); controller = pending;
  const valid = () => !closed && request === revision && same(selected, current) && same(selected, selection());
  status('Loading saved ticket instructions…'); refresh.disabled = true;
  let timeout;
  try {
    const result = await Promise.race([
      (async () => {
        const fresh = await context().db.auth.getSession();
        if (!valid() || pending.signal.aborted) return null;
        if (fresh?.error || fresh?.data?.session?.user?.id !== selected.subject) {
          authSubject = fresh?.error ? null : fresh?.data?.session?.user?.id || null;
          clear(); clearQueue(); return null;
        }
        let query = context().db.from('job_assignments')
          .select('id,ticket_no,assigned_role,assignee_user_id,assignment_scope,status,job_description,notes,unit_summary')
          .eq('ticket_no', selected.ticket).eq('assigned_role', selected.role)
          .in('status', ['assigned', 'started']).order('assigned_at', { ascending: false }).limit(10);
        if (typeof query.abortSignal === 'function') query = query.abortSignal(pending.signal);
        return await query;
      })(),
      new Promise((_, reject) => pending.signal.addEventListener('abort', () => reject(new Error('cancelled')), { once: true })),
      new Promise((_, reject) => { timeout = setTimeout(() => { pending.abort(); reject(new Error('timeout')); }, 15000); }),
    ]);
    if (!valid()) return;
    if (result?.error || !Array.isArray(result?.data)) throw new Error('unavailable');
    const rows = result.data.filter(row => row && String(row.ticket_no) === selected.ticket && row.assigned_role === selected.role && ['assigned', 'started'].includes(row.status));
    const row = rows.find(item => item.assignee_user_id === selected.subject) ||
      rows.find(item => item.assignee_user_id === null && item.assignment_scope === 'department' && item.status === 'assigned');
    if (!row) { status('No active ' + (selected.role === 'it' ? 'IT' : 'Service') + ' assignment is available to this login for this ticket.'); return; }
    if ([row.job_description, row.notes, row.unit_summary].some(value => value != null && typeof value !== 'string')) throw new Error('invalid');
    const work = row.job_description || '', notes = row.notes || '', units = row.unit_summary || '';
    content.replaceChildren();
    if (work.trim()) content.append(field('Work', work));
    if (notes.trim()) content.append(field('Notes / delivery instructions', notes));
    if (units.trim()) content.append(field('Recorded equipment / unit instructions', units));
    if (!work.trim() && !notes.trim() && !units.trim()) status('No work, delivery or unit instructions were saved on this assignment.');
  } catch {
    if (valid()) status('Ticket instructions could not be verified. Refresh instructions to retry.', true);
  } finally {
    clearTimeout(timeout);
    if (valid()) { refresh.disabled = false; controller = null; }
  }
}
function mount(selected) {
  current = selected;
  panel = document.createElement('section'); panel.id = selected.role === 'it' ? 'cosITTicketInstructions' : 'cosServiceTicketInstructions';
  panel.setAttribute('aria-label', 'Ticket work and delivery instructions');
  panel.style.cssText = 'display:block;margin:16px 0;padding:16px;border:1px solid currentColor;border-radius:10px;text-align:left;';
  const title = text('h3', 'Ticket work & delivery instructions');
  title.style.cssText = 'margin:0 0 8px;font-size:18px;';
  panel.append(title, text('p', 'MHelpDesk #' + selected.ticket + ' · Saved assignment instructions'));
  content = document.createElement('div'); content.setAttribute('aria-live', 'polite');
  refresh = text('button', 'Refresh instructions'); refresh.type = 'button'; refresh.className = 'mini'; refresh.style.minHeight = '44px';
  refresh.addEventListener('click', () => void load());
  toggle = text('button', 'Close instructions'); toggle.type = 'button'; toggle.className = 'mini';
  toggle.style.cssText = 'margin-left:8px;min-height:44px;';
  toggle.addEventListener('click', () => {
    if (!same(current, selection())) { present(); return; }
    closed = !closed; cancelRead(); content.replaceChildren();
    refresh.hidden = closed; toggle.textContent = closed ? 'Show ticket instructions' : 'Close instructions';
    if (!closed) void load();
  });
  panel.append(content, refresh, toggle); selected.anchor.after(panel); void load();
}

function queueSelection() {
  const actor = identity(), home = document.getElementById('wlSvcHome');
  if (actor?.role !== 'service' || !visible(home)) return null;
  const shells = home.querySelectorAll(':scope > .wl-service-simple-shell');
  if (shells.length !== 1 || !visible(shells[0])) return null;
  return { ...actor, anchor: home, shell: shells[0] };
}
function sameQueue(a, b) {
  return Boolean(a && b && a.subject === b.subject && a.role === b.role && a.anchor === b.anchor && a.shell === b.shell);
}
function cancelQueueRead() { queueRevision++; queueController?.abort(); queueController = null; }
function clearQueue() {
  cancelQueueRead(); queuePanel?.remove(); queueCurrent = queuePanel = queueContent = queueRefresh = null;
}
function queueStatus(message, error = false) {
  const node = text('p', message); node.setAttribute('role', error ? 'alert' : 'status');
  queueContent.replaceChildren(node);
}
function recordedSchedule(row) {
  const date = row.scheduled_for, time = row.scheduled_time;
  if (date == null && time == null) return 'Schedule not recorded';
  if (typeof date !== 'string' || !/^\d{4}-\d{2}-\d{2}$/.test(date) ||
    !Number.isFinite(Date.parse(date + 'T12:00:00Z')) || new Date(date + 'T12:00:00Z').toISOString().slice(0, 10) !== date ||
    (time != null && (typeof time !== 'string' || !/^(?:[01]\d|2[0-3]):[0-5]\d(?::[0-5]\d(?:\.\d{1,6})?)?$/.test(time)))) return 'Schedule unavailable';
  return 'Scheduled date: ' + date + (time == null ? ' · Time not recorded' : ' · ' + time + ' (recorded local time)');
}
async function loadQueue() {
  const selected = queueCurrent;
  if (!sameQueue(selected, queueSelection())) { present(); return; }
  cancelQueueRead(); const request = queueRevision;
  const pending = new AbortController(); queueController = pending;
  const valid = () => request === queueRevision && sameQueue(selected, queueCurrent) && sameQueue(selected, queueSelection());
  queueStatus('Loading Service assignments…'); queueRefresh.disabled = true;
  let timeout;
  try {
    const result = await Promise.race([
      (async () => {
        const fresh = await context().db.auth.getSession();
        if (!valid() || pending.signal.aborted) return null;
        if (fresh?.error || fresh?.data?.session?.user?.id !== selected.subject) {
          authSubject = fresh?.error ? null : fresh?.data?.session?.user?.id || null;
          clear(); clearQueue(); return null;
        }
        // RPC is the existing read-only assignment discovery boundary. Never call
        // readiness, claim, start, link, handoff or equipment actions from here.
        let query = context().db.rpc('my_available_assignments', { p_role: 'service' })
          .select('id,ticket_no,assigned_role,assignee_user_id,assignment_scope,status,scheduled_for,scheduled_time')
          .limit(51);
        if (typeof query.abortSignal === 'function') query = query.abortSignal(pending.signal);
        return await query;
      })(),
      new Promise((_, reject) => pending.signal.addEventListener('abort', () => reject(new Error('cancelled')), { once: true })),
      new Promise((_, reject) => { timeout = setTimeout(() => { pending.abort(); reject(new Error('timeout')); }, 15000); }),
    ]);
    if (!valid()) return;
    if (result?.error || !Array.isArray(result?.data)) throw new Error('unavailable');
    const rows = result.data, ids = new Set();
    // This RPC promises a scoped, unique assignment set. A malformed or foreign
    // row invalidates the response; discarding it could invent an empty queue.
    if (rows.length > 51 || rows.some(row => {
      if (!row || typeof row.id !== 'string' || !row.id.trim() || row.id !== row.id.trim() || ids.has(row.id) ||
        !validTicket(row.ticket_no) || row.assigned_role !== 'service' ||
        !['technician', 'department'].includes(row.assignment_scope) || !['assigned', 'started'].includes(row.status) ||
        !(row.assignee_user_id === selected.subject ||
          (row.assignee_user_id === null && row.assignment_scope === 'department' && row.status === 'assigned'))) return true;
      ids.add(row.id); return false;
    })) throw new Error('invalid');
    if (!rows.length) { queueStatus('No active assignments are available to this Service login.'); return; }
    const list = document.createElement('ul'); list.style.cssText = 'padding-left:20px;overflow-wrap:anywhere;';
    for (const row of rows.slice(0, 50)) {
      const item = document.createElement('li'); item.style.cssText = 'margin:14px 0;';
      item.append(text('strong', 'MHelpDesk #' + row.ticket_no),
        text('div', row.assignee_user_id === selected.subject ? 'Assigned to you' : 'Department queue'),
        text('div', row.status === 'started' ? 'Status: Started' : 'Status: Assigned'),
        text('div', recordedSchedule(row)));
      list.append(item);
    }
    queueContent.replaceChildren(list);
    if (result.data.length > 50) queueContent.append(text('p', 'Showing up to 50 available assignments. Use the exact ticket entry for other tickets.'));
  } catch {
    if (valid()) queueStatus('Service assignments could not be verified. Refresh assignments to retry.', true);
  } finally {
    clearTimeout(timeout);
    if (valid()) { queueRefresh.disabled = false; queueController = null; }
  }
}
function presentQueue() {
  const selected = queueSelection();
  if (sameQueue(queueCurrent, selected) && queuePanel?.isConnected) return;
  clearQueue(); if (!selected) return;
  queueCurrent = selected;
  queuePanel = document.createElement('section'); queuePanel.id = 'cosServiceAssignmentQueue';
  queuePanel.setAttribute('aria-label', 'Your Service assignments and department queue');
  queuePanel.style.cssText = 'display:block;margin:20px 0;padding:16px;border:1px solid currentColor;border-radius:10px;text-align:left;';
  const title = text('h3', 'Your Service assignments and department queue');
  title.style.cssText = 'margin:0 0 8px;font-size:18px;';
  queueContent = document.createElement('div'); queueContent.setAttribute('aria-live', 'polite');
  queueRefresh = text('button', 'Refresh assignments'); queueRefresh.type = 'button'; queueRefresh.className = 'mini'; queueRefresh.style.minHeight = '44px';
  queueRefresh.addEventListener('click', () => void loadQueue());
  queuePanel.append(title, text('p', 'Use Enter Ticket Number to verify a ticket and read its saved instructions before starting.'), queueContent, queueRefresh);
  selected.anchor.append(queuePanel); void loadQueue();
}

function present() {
  const auth = context()?.db?.auth;
  if (!authObserved && typeof auth?.onAuthStateChange === 'function') {
    authObserved = true;
    auth.onAuthStateChange((_event, session) => { authSubject = session?.user?.id || null; clear(); clearQueue(); queueMicrotask(present); });
  }
  presentQueue();
  const selected = selection();
  if (!same(current, selected) || (panel && !panel.isConnected)) {
    clear(); if (selected) mount(selected); return;
  }
  // Job Setup hides/reveals existing children during a redraw.
  if (panel && panel.style.display !== 'block') panel.style.display = 'block';
}
new MutationObserver(present).observe(document.body, {
  childList: true, subtree: true, characterData: true, attributes: true, attributeFilter: ['class', 'style', 'hidden'],
});
document.addEventListener('input', event => {
  if (['wlITJobSearch', 'itTicket', 'wlServiceJobSearch'].includes(event.target?.id)) present();
});
for (const event of ['techcheck:view-changed', 'popstate', 'hashchange']) window.addEventListener(event, present);
for (const event of ['techcheck:data-refreshed', 'focus']) window.addEventListener(event, () => {
  present(); if (current && !closed) void load(); if (queueCurrent) void loadQueue();
});
window.addEventListener('pagehide', () => { pageActive = false; clear(); clearQueue(); });
window.addEventListener('pageshow', () => { pageActive = true; clear(); clearQueue(); present(); });
present();
