const safetyDb = window.__techCheckDb;
const OPS_PHONE_DISPLAY = '(346) 314-9208';
const OPS_PHONE_TEL = '+13463149208';

const SAFETY_TRUCK = [
  'Fuel level sufficient for today’s route',
  'Tires appear safe and properly inflated',
  'Headlights / signals / brake lights working',
  'Windshield and mirrors are safe and clear',
  'No visible fluid leaks',
  'Required tools and service supplies onboard',
  'Ladders / cargo / equipment secured',
  'Truck cab and bed organized',
];

const SAFETY_TRAILER = [
  'Trailer tires appear safe and properly inflated',
  'Hitch / coupler fully secured',
  'Safety chains attached correctly',
  'Trailer plug connected; lights and signals working',
  'Jack / supports secured for travel',
  'Load balanced and equipment tied down',
  'No visible structural damage or unsafe condition',
];

function safetyEsc(value) {
  return String(value ?? '').replace(/[&<>"']/g, ch => ({
    '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#039;',
  })[ch]);
}

function injectSafetyStyles() {
  if (document.getElementById('cosSafetyStyles')) return;
  const style = document.createElement('style');
  style.id = 'cosSafetyStyles';
  style.textContent = `
    .pf-check{border-bottom:1px solid #edf0f2;padding:12px 0}
    .pf-check:last-child{border-bottom:0}
    .pf-title{font-weight:800;margin-bottom:9px}
    .pf-options{display:grid;grid-template-columns:1fr 1fr;gap:8px}
    .pf-option{display:flex;align-items:center;justify-content:center;gap:7px;border:2px solid #d5dde5;border-radius:10px;padding:10px;font-weight:900;background:#fff;cursor:pointer}
    .pf-option input{width:20px;height:20px;margin:0;flex:none}
    .pf-option.pass:has(input:checked){border-color:#2f855a;background:#edf9f1;color:#166534}
    .pf-option.fail:has(input:checked){border-color:#c0392b;background:#fff0ef;color:#a61b12}
    .ops-call{display:block;text-align:center;text-decoration:none;background:#a61b12;color:#fff!important;border-radius:11px;padding:14px;font-weight:900;margin-top:10px}
    .handoff-stamp{background:#f8fafc;border:1px solid #d9e0e6;border-radius:10px;padding:10px;margin-top:9px}
    .handoff-stamp b{display:block}
    .stamp-line{margin-top:4px;font-size:13px;color:#53606c}
    @media(max-width:680px){.pf-options{grid-template-columns:1fr 1fr}}
  `;
  document.head.appendChild(style);
}

function passFailRow(prefix, index, text) {
  const name = prefix + '_pf_' + index;
  return '<div class="pf-check" data-pf-group="' + prefix + '" data-pf-index="' + index + '">' +
    '<div class="pf-title">' + safetyEsc(text) + '</div>' +
    '<div class="pf-options">' +
      '<label class="pf-option pass"><input type="radio" name="' + name + '" value="true"><span>PASS</span></label>' +
      '<label class="pf-option fail"><input type="radio" name="' + name + '" value="false"><span>FAIL</span></label>' +
    '</div>' +
  '</div>';
}

function installPassFailChecks() {
  const truck = document.getElementById('truckChecks');
  const trailer = document.getElementById('trailerChecks');
  if (!truck || !trailer) return;

  if (truck.dataset.passFail !== 'true') {
    truck.dataset.passFail = 'true';
    truck.innerHTML = SAFETY_TRUCK.map((text, i) => passFailRow('truck', i, text)).join('');
    truck.addEventListener('change', updateSafetyMorningStatus);
  }
  if (trailer.dataset.passFail !== 'true') {
    trailer.dataset.passFail = 'true';
    trailer.innerHTML = SAFETY_TRAILER.map((text, i) => passFailRow('trailer', i, text)).join('');
    trailer.addEventListener('change', updateSafetyMorningStatus);
  }

  const takingTrailer = document.getElementById('takingTrailer');
  if (takingTrailer && takingTrailer.dataset.passFailWired !== 'true') {
    takingTrailer.dataset.passFailWired = 'true';
    takingTrailer.addEventListener('change', () => {
      const area = document.getElementById('trailerArea');
      area?.classList.toggle('hidden', !takingTrailer.checked);
      updateSafetyMorningStatus();
    });
  }

  const reviewed = document.getElementById('mhelpReviewed');
  if (reviewed && reviewed.dataset.passFailWired !== 'true') {
    reviewed.dataset.passFailWired = 'true';
    reviewed.addEventListener('change', updateSafetyMorningStatus);
  }

  updateSafetyMorningStatus();
}

function readPassFail(prefix, count) {
  const values = [];
  for (let i = 0; i < count; i++) {
    const selected = document.querySelector('input[name="' + prefix + '_pf_' + i + '"]:checked');
    values.push(selected ? selected.value === 'true' : null);
  }
  return values;
}

function matchedServiceCount() {
  return document.querySelectorAll('#matchedPreps > .item.prepared').length;
}

function ensureCallBox() {
  let box = document.getElementById('operationsCallBox');
  if (box) return box;
  const status = document.getElementById('truckStatus');
  if (!status) return null;
  box = document.createElement('div');
  box.id = 'operationsCallBox';
  status.after(box);
  return box;
}

function callManagerMarkup(submitted = false) {
  return '<div class="bad"><b>FAILED INSPECTION ITEM — CALL OPERATIONS MANAGER</b>' +
    '<div class="small">' + (submitted
      ? 'The check was submitted with a failed item. Call before proceeding.'
      : 'A truck or trailer item failed. Call now so it can be addressed before proceeding.') +
    '</div><a class="ops-call" href="tel:' + OPS_PHONE_TEL + '">Call Operations Manager — ' + OPS_PHONE_DISPLAY + '</a></div>';
}

function updateSafetyMorningStatus() {
  const status = document.getElementById('truckStatus');
  if (!status) return;

  const issues = [];
  if (!document.getElementById('mhelpReviewed')?.checked) issues.push('MHelpDesk jobs not reviewed');
  if (matchedServiceCount() > 0) issues.push('Matched equipment receipt / verification still incomplete');

  const truck = readPassFail('truck', SAFETY_TRUCK.length);
  if (truck.some(v => v === null)) issues.push('Mark every truck item PASS or FAIL');

  const takingTrailer = !!document.getElementById('takingTrailer')?.checked;
  const trailer = readPassFail('trailer', SAFETY_TRAILER.length);
  if (takingTrailer && trailer.some(v => v === null)) issues.push('Mark every trailer item PASS or FAIL');

  const anyFail = truck.some(v => v === false) || (takingTrailer && trailer.some(v => v === false));
  const callBox = ensureCallBox();

  if (issues.length) {
    status.innerHTML = '<div class="warn"><b>Morning check not complete</b><div class="small">' +
      issues.map(safetyEsc).join('<br>') + '</div></div>';
  } else if (anyFail) {
    status.innerHTML = '<div class="bad"><b>READY TO SUBMIT — FAILED ITEM REQUIRES MANAGER CALL</b></div>';
  } else {
    status.innerHTML = '<div class="ok"><b>READY TO SUBMIT MORNING CHECK</b></div>';
  }

  if (callBox) callBox.innerHTML = anyFail ? callManagerMarkup(false) : '';
}

function collectClosedTickets() {
  const text = document.getElementById('sessionClosed')?.textContent || '';
  const tickets = [];
  const re = /MHelpDesk Ticket\s*#([^·\s]+)/gi;
  let match;
  while ((match = re.exec(text))) tickets.push(match[1]);
  return [...new Set(tickets)];
}

async function submitSafetyMorning() {
  const message = document.getElementById('morningMessage');
  if (message) message.innerHTML = '';

  if (!document.getElementById('mhelpReviewed')?.checked) {
    if (message) message.innerHTML = '<div class="bad">Confirm that you reviewed today’s MHelpDesk jobs.</div>';
    return;
  }
  if (matchedServiceCount() > 0) {
    if (message) message.innerHTML = '<div class="bad">Receive and verify every matched equipment handoff first.</div>';
    return;
  }

  const truckValues = readPassFail('truck', SAFETY_TRUCK.length);
  if (truckValues.some(v => v === null)) {
    if (message) message.innerHTML = '<div class="bad">Mark all 8 truck inspection items PASS or FAIL.</div>';
    return;
  }

  const takingTrailer = !!document.getElementById('takingTrailer')?.checked;
  const trailerValues = readPassFail('trailer', SAFETY_TRAILER.length);
  if (takingTrailer && trailerValues.some(v => v === null)) {
    if (message) message.innerHTML = '<div class="bad">Mark all 7 trailer inspection items PASS or FAIL.</div>';
    return;
  }

  const truckChecks = {};
  truckValues.forEach((value, i) => { truckChecks['truck_' + (i + 1)] = value; });
  const trailerChecks = {};
  trailerValues.forEach((value, i) => { trailerChecks['trailer_' + (i + 1)] = value; });
  const anyFail = truckValues.some(v => v === false) || (takingTrailer && trailerValues.some(v => v === false));

  document.body.classList.add('busy');
  let error;
  try {
    ({ error } = await safetyDb.rpc('submit_morning_check', {
      p_mhelp_reviewed: true,
      p_truck_checks: truckChecks,
      p_taking_trailer: takingTrailer,
      p_trailer_checks: trailerChecks,
      p_closed_ticket_nos: collectClosedTickets(),
    }));
  } finally {
    document.body.classList.remove('busy');
  }

  if (error) {
    if (message) message.innerHTML = '<div class="bad">' + safetyEsc(error.message) + '</div>';
    return;
  }

  if (message) {
    message.innerHTML = anyFail
      ? '<div class="bad"><b>Morning check submitted with a FAILED inspection item.</b><div class="small">Call the Operations Manager now and do not proceed until the issue is addressed.</div><a class="ops-call" href="tel:' + OPS_PHONE_TEL + '">Call Operations Manager — ' + OPS_PHONE_DISPLAY + '</a></div>'
      : '<div class="ok"><b>Morning readiness check submitted.</b><div class="small">All required inspection items were marked PASS.</div></div>';
  }

  const callBox = ensureCallBox();
  if (callBox) callBox.innerHTML = anyFail ? callManagerMarkup(true) : '';
}

function safetyToggleTrailer() {
  const taking = !!document.getElementById('takingTrailer')?.checked;
  document.getElementById('trailerArea')?.classList.toggle('hidden', !taking);
  updateSafetyMorningStatus();
}

function normalizeSafetyTicket(value) {
  return String(value || '').trim().toLowerCase().replace(/[^a-z0-9]/g, '');
}

function stampMarkup(prep, includeService) {
  const itName = prep.released_by_name || 'IT Tech';
  const serviceName = prep.closed_by_name || 'Service Tech';
  let html = '<div class="handoff-stamp">' +
    '<b>Prepared by IT: ' + safetyEsc(itName) + '</b>' +
    (prep.released_at ? '<div class="stamp-line">Sent to Service: ' + new Date(prep.released_at).toLocaleString() + '</div>' : '');
  if (includeService && prep.status === 'closed') {
    html += '<b style="margin-top:8px">Received & Verified by Service: ' + safetyEsc(serviceName) + '</b>' +
      (prep.closed_at ? '<div class="stamp-line">Accepted / deployed: ' + new Date(prep.closed_at).toLocaleString() + '</div>' : '');
  }
  return html + '</div>';
}

let stamping = false;
async function stampHandoffs() {
  if (stamping || !safetyDb) return;
  const serviceCards = [...document.querySelectorAll('#matchedPreps > .item.prepared')];
  const handoffCards = [...document.querySelectorAll('#itHandoffList [data-handoff-prep]')];
  if (!serviceCards.length && !handoffCards.length) return;

  stamping = true;
  try {
    const { data, error } = await safetyDb
      .from('prep_tickets')
      .select('id,ticket_no,status,released_by_name,closed_by_name,released_at,closed_at');
    if (error) return;
    const preps = data || [];
    const byId = new Map(preps.map(p => [p.id, p]));
    const byTicket = new Map(preps.map(p => [normalizeSafetyTicket(p.ticket_no), p]));

    handoffCards.forEach(card => {
      const prep = byId.get(card.dataset.handoffPrep);
      if (!prep) return;
      const head = card.querySelector('.ticketHead');
      let stamp = card.querySelector('.handoff-stamp');
      const html = stampMarkup(prep, true);
      if (!stamp && head) {
        head.insertAdjacentHTML('afterend', html);
      } else if (stamp && stamp.outerHTML !== html) {
        stamp.outerHTML = html;
      }
    });

    serviceCards.forEach(card => {
      const text = card.querySelector('.ticketHead b')?.textContent || '';
      const raw = text.replace(/^.*?#/, '');
      const prep = byTicket.get(normalizeSafetyTicket(raw));
      if (!prep) return;
      const head = card.querySelector('.ticketHead');
      let stamp = card.querySelector('.handoff-stamp');
      const html = stampMarkup(prep, false);
      if (!stamp && head) {
        head.insertAdjacentHTML('afterend', html);
      } else if (stamp && stamp.outerHTML !== html) {
        stamp.outerHTML = html;
      }
    });
  } finally {
    stamping = false;
  }
}

function installStampObservers() {
  ['matchedPreps', 'itHandoffList'].forEach(id => {
    const node = document.getElementById(id);
    if (!node || node.dataset.stampObserver === 'true') return;
    node.dataset.stampObserver = 'true';
    new MutationObserver(() => setTimeout(stampHandoffs, 40)).observe(node, { childList: true, subtree: true });
  });
  stampHandoffs();
}

function installSafetyWorkflow() {
  injectSafetyStyles();
  installPassFailChecks();
  installStampObservers();

  window.updateMorningStatus = updateSafetyMorningStatus;
  window.submitMorning = submitSafetyMorning;
  window.toggleTrailer = safetyToggleTrailer;

  const morning = document.getElementById('view-svc');
  if (morning) {
    new MutationObserver(() => {
      installPassFailChecks();
      installStampObservers();
      setTimeout(updateSafetyMorningStatus, 20);
    }).observe(morning, { childList: true, subtree: true });
  }

  const handoff = document.getElementById('itHandoffCard');
  if (handoff) {
    new MutationObserver(() => setTimeout(stampHandoffs, 40)).observe(handoff, { childList: true, subtree: true });
  }

  setTimeout(() => {
    installPassFailChecks();
    installStampObservers();
    stampHandoffs();
    updateSafetyMorningStatus();
  }, 250);
}

if (document.readyState === 'loading') {
  document.addEventListener('DOMContentLoaded', installSafetyWorkflow);
} else {
  installSafetyWorkflow();
}
