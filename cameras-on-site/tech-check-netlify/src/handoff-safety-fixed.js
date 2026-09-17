const safetyDbFixed = window.__techCheckDb;
const OPS_PHONE_DISPLAY_FIXED = '(346) 314-9208';
const OPS_PHONE_TEL_FIXED = '+13463149208';

const TRUCK_FIXED = [
  'Fuel level sufficient for today’s route',
  'Tires appear safe and properly inflated',
  'Headlights / signals / brake lights working',
  'Windshield and mirrors are safe and clear',
  'No visible fluid leaks',
  'Required tools and service supplies onboard',
  'Ladders / cargo / equipment secured',
  'Truck cab and bed organized',
];

const TRAILER_FIXED = [
  'Trailer tires appear safe and properly inflated',
  'Hitch / coupler fully secured',
  'Safety chains attached correctly',
  'Trailer plug connected; lights and signals working',
  'Jack / supports secured for travel',
  'Load balanced and equipment tied down',
  'No visible structural damage or unsafe condition',
];

function sfEsc(value) {
  return String(value ?? '').replace(/[&<>"']/g, ch => ({
    '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#039;',
  })[ch]);
}

function sfStyles() {
  if (document.getElementById('cosSafetyStylesFixed')) return;
  const style = document.createElement('style');
  style.id = 'cosSafetyStylesFixed';
  style.textContent = `
    .pf-check{border-bottom:1px solid #edf0f2;padding:12px 0}
    .pf-check:last-child{border-bottom:0}
    .pf-title{font-weight:800;margin-bottom:9px}
    .pf-options{display:grid;grid-template-columns:1fr 1fr;gap:8px}
    .pf-option{display:flex;align-items:center;justify-content:center;gap:7px;border:2px solid #d5dde5;border-radius:10px;padding:10px;font-weight:900;background:#fff;cursor:pointer}
    .pf-option input{width:20px;height:20px;margin:0;flex:none}
    .pf-option.pass:has(input:checked){border-color:#2f855a;background:#edf9f1;color:#166534}
    .pf-option.fail:has(input:checked){border-color:#c0392b;background:#fff0ef;color:#a61b12}
    .ops-call-fixed{display:block;text-align:center;text-decoration:none;background:#a61b12;color:#fff!important;border-radius:11px;padding:14px;font-weight:900;margin-top:10px}
    .ops-call-fixed.normal{background:#2f6fb8}
    .handoff-stamp-fixed{background:#f8fafc;border:1px solid #d9e0e6;border-radius:10px;padding:10px;margin-top:9px}
    .handoff-stamp-fixed b{display:block}
    .stamp-line-fixed{margin-top:4px;font-size:13px;color:#53606c}
  `;
  document.head.appendChild(style);
}

function sfRow(prefix, index, text) {
  const name = prefix + '_pf_' + index;
  return '<div class="pf-check">' +
    '<div class="pf-title">' + sfEsc(text) + '</div>' +
    '<div class="pf-options">' +
      '<label class="pf-option pass"><input type="radio" name="' + name + '" value="true"><span>PASS</span></label>' +
      '<label class="pf-option fail"><input type="radio" name="' + name + '" value="false"><span>FAIL</span></label>' +
    '</div></div>';
}

function sfInstallChecks() {
  const truck = document.getElementById('truckChecks');
  const trailer = document.getElementById('trailerChecks');
  if (!truck || !trailer) return;

  if (truck.dataset.passFailFixed !== 'true') {
    truck.dataset.passFailFixed = 'true';
    truck.innerHTML = TRUCK_FIXED.map((text, i) => sfRow('truck', i, text)).join('');
    truck.addEventListener('change', sfUpdateStatus);
  }
  if (trailer.dataset.passFailFixed !== 'true') {
    trailer.dataset.passFailFixed = 'true';
    trailer.innerHTML = TRAILER_FIXED.map((text, i) => sfRow('trailer', i, text)).join('');
    trailer.addEventListener('change', sfUpdateStatus);
  }

  const taking = document.getElementById('takingTrailer');
  if (taking && taking.dataset.passFailFixed !== 'true') {
    taking.dataset.passFailFixed = 'true';
    taking.addEventListener('change', sfToggleTrailer);
  }
  const reviewed = document.getElementById('mhelpReviewed');
  if (reviewed && reviewed.dataset.passFailFixed !== 'true') {
    reviewed.dataset.passFailFixed = 'true';
    reviewed.addEventListener('change', sfUpdateStatus);
  }
}

function sfRead(prefix, count) {
  const out = [];
  for (let i = 0; i < count; i++) {
    const selected = document.querySelector('input[name="' + prefix + '_pf_' + i + '"]:checked');
    out.push(selected ? selected.value === 'true' : null);
  }
  return out;
}

function sfMatchedCount() {
  return document.querySelectorAll('#matchedPreps > .item.prepared').length;
}

function sfCallLink(extraClass = '') {
  return '<a class="ops-call-fixed ' + extraClass + '" href="tel:' + OPS_PHONE_TEL_FIXED + '">Call Operations Manager — ' + OPS_PHONE_DISPLAY_FIXED + '</a>';
}

function sfCallBox() {
  let box = document.getElementById('operationsCallBox');
  if (box) return box;
  const status = document.getElementById('truckStatus');
  if (!status) return null;
  box = document.createElement('div');
  box.id = 'operationsCallBox';
  status.after(box);
  return box;
}

function sfUpdateStatus() {
  const status = document.getElementById('truckStatus');
  if (!status) return;

  const issues = [];
  if (!document.getElementById('mhelpReviewed')?.checked) issues.push('MHelpDesk jobs not reviewed');
  if (sfMatchedCount() > 0) issues.push('Matched equipment receipt / verification still incomplete');

  const truck = sfRead('truck', TRUCK_FIXED.length);
  if (truck.some(v => v === null)) issues.push('Mark every truck item PASS or FAIL');

  const taking = !!document.getElementById('takingTrailer')?.checked;
  const trailer = sfRead('trailer', TRAILER_FIXED.length);
  if (taking && trailer.some(v => v === null)) issues.push('Mark every trailer item PASS or FAIL');

  const failed = truck.some(v => v === false) || (taking && trailer.some(v => v === false));
  if (issues.length) {
    status.innerHTML = '<div class="warn"><b>Morning check not complete</b><div class="small">' + issues.map(sfEsc).join('<br>') + '</div></div>';
  } else if (failed) {
    status.innerHTML = '<div class="bad"><b>READY TO SUBMIT — FAILED ITEM REQUIRES MANAGER CALL</b></div>';
  } else {
    status.innerHTML = '<div class="ok"><b>READY TO SUBMIT MORNING CHECK</b></div>';
  }

  const box = sfCallBox();
  if (box) {
    box.innerHTML = failed
      ? '<div class="bad"><b>FAILED INSPECTION ITEM — CALL OPERATIONS MANAGER</b><div class="small">Call now so the issue can be addressed before proceeding.</div>' + sfCallLink() + '</div>'
      : '';
  }
}

function sfClosedTickets() {
  const text = document.getElementById('sessionClosed')?.textContent || '';
  const tickets = [];
  const re = /MHelpDesk Ticket\s*#([^·\s]+)/gi;
  let match;
  while ((match = re.exec(text))) tickets.push(match[1]);
  return [...new Set(tickets)];
}

async function sfSubmitMorning() {
  const message = document.getElementById('morningMessage');
  if (message) message.innerHTML = '';

  if (!document.getElementById('mhelpReviewed')?.checked) {
    if (message) message.innerHTML = '<div class="bad">Confirm that you reviewed today’s MHelpDesk jobs.</div>';
    return;
  }
  if (sfMatchedCount() > 0) {
    if (message) message.innerHTML = '<div class="bad">Receive and verify every matched equipment handoff first.</div>';
    return;
  }

  const truck = sfRead('truck', TRUCK_FIXED.length);
  if (truck.some(v => v === null)) {
    if (message) message.innerHTML = '<div class="bad">Mark all 8 truck inspection items PASS or FAIL.</div>';
    return;
  }
  const taking = !!document.getElementById('takingTrailer')?.checked;
  const trailer = sfRead('trailer', TRAILER_FIXED.length);
  if (taking && trailer.some(v => v === null)) {
    if (message) message.innerHTML = '<div class="bad">Mark all 7 trailer inspection items PASS or FAIL.</div>';
    return;
  }

  const truckChecks = {};
  truck.forEach((value, i) => { truckChecks['truck_' + (i + 1)] = value; });
  const trailerChecks = {};
  trailer.forEach((value, i) => { trailerChecks['trailer_' + (i + 1)] = value; });
  const failed = truck.some(v => v === false) || (taking && trailer.some(v => v === false));

  document.body.classList.add('busy');
  let error;
  try {
    ({ error } = await safetyDbFixed.rpc('submit_morning_check', {
      p_mhelp_reviewed: true,
      p_truck_checks: truckChecks,
      p_taking_trailer: taking,
      p_trailer_checks: trailerChecks,
      p_closed_ticket_nos: sfClosedTickets(),
    }));
  } finally {
    document.body.classList.remove('busy');
  }

  if (error) {
    if (message) message.innerHTML = '<div class="bad">' + sfEsc(error.message) + '</div>';
    return;
  }

  if (message) {
    message.innerHTML = failed
      ? '<div class="bad"><b>Morning check submitted with a FAILED inspection item.</b><div class="small">Call the Operations Manager now and do not proceed until the issue is addressed.</div>' + sfCallLink() + '</div>'
      : '<div class="ok"><b>Morning readiness check submitted.</b><div class="small">All required inspection items were marked PASS.</div>' + sfCallLink('normal') + '</div>';
  }
  const box = sfCallBox();
  if (box) box.innerHTML = failed ? '<div class="bad"><b>FAILED INSPECTION SUBMITTED</b>' + sfCallLink() + '</div>' : '';
}

function sfToggleTrailer() {
  const taking = !!document.getElementById('takingTrailer')?.checked;
  document.getElementById('trailerArea')?.classList.toggle('hidden', !taking);
  sfUpdateStatus();
}

function sfNormalizeTicket(value) {
  return String(value || '').trim().toLowerCase().replace(/[^a-z0-9]/g, '');
}

function sfStampMarkup(prep, includeService) {
  const itName = prep.released_by_name || 'IT Tech';
  const serviceName = prep.closed_by_name || 'Service Tech';
  let html = '<div class="handoff-stamp-fixed">' +
    '<b>Prepared by IT: ' + sfEsc(itName) + '</b>' +
    (prep.released_at ? '<div class="stamp-line-fixed">Sent to Service: ' + new Date(prep.released_at).toLocaleString() + '</div>' : '');
  if (includeService && prep.status === 'closed') {
    html += '<b style="margin-top:8px">Received & Verified by Service: ' + sfEsc(serviceName) + '</b>' +
      (prep.closed_at ? '<div class="stamp-line-fixed">Accepted / deployed: ' + new Date(prep.closed_at).toLocaleString() + '</div>' : '');
  }
  return html + '</div>';
}

let sfStamping = false;
async function sfStampHandoffs() {
  if (sfStamping || !safetyDbFixed) return;
  const serviceCards = [...document.querySelectorAll('#matchedPreps > .item.prepared')];
  const handoffCards = [...document.querySelectorAll('#itHandoffList [data-handoff-prep]')];
  if (!serviceCards.length && !handoffCards.length) return;

  sfStamping = true;
  try {
    const { data, error } = await safetyDbFixed
      .from('prep_tickets')
      .select('id,ticket_no,status,released_by_name,closed_by_name,released_at,closed_at');
    if (error) return;
    const preps = data || [];
    const byId = new Map(preps.map(p => [p.id, p]));
    const byTicket = new Map(preps.map(p => [sfNormalizeTicket(p.ticket_no), p]));

    handoffCards.forEach(card => {
      const prep = byId.get(card.dataset.handoffPrep);
      if (!prep || card.querySelector('.handoff-stamp-fixed')) return;
      card.querySelector('.ticketHead')?.insertAdjacentHTML('afterend', sfStampMarkup(prep, true));
    });

    serviceCards.forEach(card => {
      if (card.querySelector('.handoff-stamp-fixed')) return;
      const raw = (card.querySelector('.ticketHead b')?.textContent || '').replace(/^.*?#/, '');
      const prep = byTicket.get(sfNormalizeTicket(raw));
      if (!prep) return;
      card.querySelector('.ticketHead')?.insertAdjacentHTML('afterend', sfStampMarkup(prep, false));
    });
  } finally {
    sfStamping = false;
  }
}

function sfObserveDirectChildren(id) {
  const node = document.getElementById(id);
  if (!node || node.dataset.sfDirectObserver === 'true') return;
  node.dataset.sfDirectObserver = 'true';
  new MutationObserver(() => {
    setTimeout(() => {
      sfStampHandoffs();
      sfUpdateStatus();
    }, 20);
  }).observe(node, { childList: true });
}

function sfInstall() {
  sfStyles();
  sfInstallChecks();
  window.updateMorningStatus = sfUpdateStatus;
  window.submitMorning = sfSubmitMorning;
  window.toggleTrailer = sfToggleTrailer;

  sfObserveDirectChildren('matchedPreps');
  sfObserveDirectChildren('itHandoffList');
  sfStampHandoffs();
  sfUpdateStatus();

  setTimeout(() => {
    sfInstallChecks();
    sfObserveDirectChildren('matchedPreps');
    sfObserveDirectChildren('itHandoffList');
    sfStampHandoffs();
    sfUpdateStatus();
  }, 300);
}

if (document.readyState === 'loading') {
  document.addEventListener('DOMContentLoaded', sfInstall);
} else {
  sfInstall();
}
