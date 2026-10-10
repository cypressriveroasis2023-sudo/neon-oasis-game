// Read-only instructions beside protected IT lookup, equipment selection and prep.
// The legacy workflow owns every claim, start, selection and handoff action.
const context = () => window.TechCheckContext;
let authObserved = false, authSubject, revision = 0, current = null;
let panel = null, content = null, refresh = null, toggle = null, controller = null;
let closed = false, pageActive = true;
const cleanTicket = value => typeof value === 'string' ? value.trim().replace(/^#\s*/, '') : '';
const visible = node => Boolean(node?.isConnected && node.getClientRects().length);
function identity() {
  const c = context(), id = c?.getSession()?.user?.id, profile = c?.getProfile();
  return pageActive && id && c?.getRole() === 'it' && c?.getEffectiveRole() === 'it' &&
    profile?.user_id === id && profile.active === true && !profile.archived_at &&
    (authSubject === undefined || authSubject === id) &&
    !document.body.classList.contains('owner-test-role-preview') &&
    visible(document.getElementById('appView')) && visible(document.getElementById('view-it')) ? id : null;
}
function selection() {
  const subject = identity();
  if (!subject) return null;
  const wizard = document.getElementById('wlItWizardOnly');
  if (visible(wizard)) {
    // Contract: protected progress() renders activeItPrep.ticket_no only in this
    // direct header child. Never scrape body text or carry a previous ticket.
    const heads = wizard.querySelectorAll(':scope > .wl-head');
    const labels = wizard.querySelectorAll(':scope > .wl-head > .small');
    if (heads.length !== 1 || labels.length !== 1 || !visible(labels[0])) return null;
    const match = /^MHelpDesk Ticket #([^\r\n]{1,80})$/.exec(labels[0].textContent);
    if (!match || !match[1].trim() || match[1] !== cleanTicket(match[1])) return null;
    return { subject, ticket: match[1], anchor: heads[0], mode: 'prep' };
  }
  const found = document.querySelector('#wlITJobSearchMsg .wl-it-ticket-found');
  if (visible(found) && found.querySelector('.wl-it-job-type')) {
    const ticket = cleanTicket(found.querySelector('.wl-it-ticket-number')?.textContent);
    if (ticket && ticket === cleanTicket(document.getElementById('wlITJobSearch')?.value))
      return { subject, ticket, anchor: found.querySelector('.wl-it-job-type'), mode: 'lookup' };
  }
  const input = document.getElementById('itTicket'), card = input?.closest('.card');
  const head = card?.querySelector('#wlCreateHead');
  // A hidden stale ticket input is not evidence of the current per-unit wizard.
  if (visible(card) && visible(head) && visible(card.querySelector('#wlCreateNav'))) {
    const ticket = cleanTicket(input.value);
    if (ticket) return { subject, ticket, anchor: head, mode: 'setup' };
  }
  return null;
}
function same(a, b) {
  return Boolean(a && b && a.subject === b.subject && a.ticket === b.ticket && a.anchor === b.anchor && a.mode === b.mode);
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
        if (!valid()) return null;
        if (fresh?.error || fresh?.data?.session?.user?.id !== selected.subject) {
          authSubject = fresh?.error ? null : fresh?.data?.session?.user?.id || null;
          clear(); return null;
        }
        let query = context().db.from('job_assignments')
          .select('id,ticket_no,assigned_role,assignee_user_id,assignment_scope,status,job_description,notes')
          .eq('ticket_no', selected.ticket).eq('assigned_role', 'it')
          .in('status', ['assigned', 'started']).order('assigned_at', { ascending: false }).limit(10);
        if (typeof query.abortSignal === 'function') query = query.abortSignal(pending.signal);
        return await query;
      })(),
      new Promise((_, reject) => pending.signal.addEventListener('abort', () => reject(new Error('cancelled')), { once: true })),
      new Promise((_, reject) => { timeout = setTimeout(() => { pending.abort(); reject(new Error('timeout')); }, 15000); }),
    ]);
    if (!valid()) return;
    if (result?.error || !Array.isArray(result?.data)) throw new Error('unavailable');
    const rows = result.data.filter(row => row && String(row.ticket_no) === selected.ticket && row.assigned_role === 'it' && ['assigned', 'started'].includes(row.status));
    const row = rows.find(item => item.assignee_user_id === selected.subject) ||
      rows.find(item => !item.assignee_user_id && item.assignment_scope === 'department');
    if (!row) { status('No active IT assignment is available to this login for this ticket.'); return; }
    if ([row.job_description, row.notes].some(value => value != null && typeof value !== 'string')) throw new Error('invalid');
    const work = row.job_description || '', notes = row.notes || '';
    content.replaceChildren();
    if (work.trim()) content.append(field('Work', work));
    if (notes.trim()) content.append(field('Notes / delivery instructions', notes));
    if (!work.trim() && !notes.trim()) status('No work or delivery instructions were saved on this assignment.');
  } catch {
    if (valid()) status('Ticket instructions could not be verified. Refresh instructions to retry.', true);
  } finally {
    clearTimeout(timeout);
    if (valid()) { refresh.disabled = false; controller = null; }
  }
}
function mount(selected) {
  current = selected;
  panel = document.createElement('section'); panel.id = 'cosITTicketInstructions';
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
function present() {
  const auth = context()?.db?.auth;
  if (!authObserved && typeof auth?.onAuthStateChange === 'function') {
    authObserved = true;
    auth.onAuthStateChange((_event, session) => { authSubject = session?.user?.id || null; clear(); queueMicrotask(present); });
  }
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
  if (['wlITJobSearch', 'itTicket'].includes(event.target?.id)) present();
});
for (const event of ['techcheck:view-changed', 'popstate', 'hashchange']) window.addEventListener(event, present);
for (const event of ['techcheck:data-refreshed', 'focus']) window.addEventListener(event, () => {
  present(); if (current && !closed) void load();
});
window.addEventListener('pagehide', () => { pageActive = false; clear(); });
window.addEventListener('pageshow', () => { pageActive = true; clear(); present(); });
present();
