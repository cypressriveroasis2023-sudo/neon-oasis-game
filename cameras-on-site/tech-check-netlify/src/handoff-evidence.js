const evidenceDb = window.__techCheckDb;
const EVIDENCE_BUCKET = 'handoff-evidence';
let evidenceTimer = null;
let evidenceRendering = false;

function eEsc(v) {
  return String(v ?? '').replace(/[&<>"']/g, c => ({
    '&':'&amp;','<':'&lt;','>':'&gt;','"':'&quot;',"'":'&#039;'
  })[c]);
}
function eNormalize(v) { return String(v || '').trim().toLowerCase().replace(/[^a-z0-9]/g,''); }
function eRole() { return document.getElementById('whoRole')?.textContent || ''; }
function eOwner() { return eRole().includes('Owner/Admin'); }
function eIT() { return eRole().includes('IT Tech') || eOwner(); }
function eService() { return eRole().includes('Service Tech') || eOwner(); }

function installEvidenceStyles() {
  if (document.getElementById('cosEvidenceStyles')) return;
  const s = document.createElement('style');
  s.id = 'cosEvidenceStyles';
  s.textContent = `
    .evidence-panel{border:2px solid #c8dff3;background:#f8fcff;border-radius:14px;padding:13px;margin-top:13px}
    .evidence-panel.service{border-color:#a9d7bf;background:#f7fcf9}.evidence-head{display:flex;align-items:center;justify-content:space-between;gap:8px;margin-bottom:6px}.evidence-head b{font-size:16px}
    .evidence-step{display:inline-block;border-radius:999px;background:#ddecfb;color:#145f97;font-weight:900;font-size:11px;padding:5px 8px}.evidence-panel.service .evidence-step{background:#ddf3e7;color:#176a47}
    .evidence-note{font-size:12px;color:#5a6875;margin-bottom:10px}.evidence-upload{border:1px solid #d5e1eb;background:#fff;border-radius:11px;padding:10px;margin-top:9px}.evidence-upload label{margin-top:0}
    .evidence-gallery{display:grid;grid-template-columns:repeat(3,minmax(0,1fr));gap:7px;margin-top:9px}.evidence-photo{border:1px solid #dce3e8;border-radius:9px;overflow:hidden;background:#fff}.evidence-photo img{width:100%;height:92px;object-fit:cover;display:block}.evidence-photo .small{padding:5px;font-size:9px;line-height:1.25}
    .evidence-signature{border:1px solid #d5e1eb;background:#fff;border-radius:11px;padding:10px;margin-top:10px}.evidence-signature canvas{width:100%;height:130px;border:2px dashed #aebdca;border-radius:9px;background:#fff;touch-action:none;display:block}
    .evidence-sig-actions{display:grid;grid-template-columns:1fr 2fr;gap:7px;margin-top:7px}.evidence-saved{border:1px solid #a9d7bf;background:#eefaf3;border-radius:10px;padding:9px;margin-top:8px}.evidence-saved img{width:100%;max-height:105px;object-fit:contain;background:#fff;border-radius:7px;margin-top:6px}.evidence-proof{border:1px solid #d7e0e7;border-radius:11px;padding:10px;margin-top:9px;background:#fff}.evidence-proof-title{font-weight:900;margin-bottom:6px}.evidence-lock{font-size:11px;font-weight:800;margin-top:7px;color:#8a5200;background:#fff4dc;border-radius:8px;padding:7px}.evidence-ready{color:#176a47;background:#eaf8f0}
    button.evidence-disabled,button:disabled.evidence-disabled{opacity:.48!important;filter:grayscale(.15);cursor:not-allowed!important}
    @media(max-width:520px){.evidence-gallery{grid-template-columns:repeat(2,minmax(0,1fr))}.evidence-sig-actions{grid-template-columns:1fr}}
  `;
  document.head.appendChild(s);
}

async function evidenceRows(prepId) {
  const { data, error } = await evidenceDb.from('handoff_evidence').select('*').eq('prep_ticket_id', prepId).order('created_at',{ascending:true});
  if (error) return [];
  const rows = data || [];
  for (const row of rows) {
    const { data: signed } = await evidenceDb.storage.from(EVIDENCE_BUCKET).createSignedUrl(row.storage_path, 3600);
    row.signed_url = signed?.signedUrl || '';
  }
  return rows;
}

function photoGallery(rows) {
  const photos = rows.filter(r => r.kind === 'photo');
  if (!photos.length) return '<div class="small">No photos uploaded yet.</div>';
  return '<div class="evidence-gallery">' + photos.map(r =>
    `<div class="evidence-photo">${r.signed_url ? `<img src="${eEsc(r.signed_url)}" alt="Handoff photo">` : ''}<div class="small"><b>${eEsc(r.created_by_name)}</b><br>${new Date(r.created_at).toLocaleString()}</div></div>`
  ).join('') + '</div>';
}

function savedSignature(rows, label) {
  const sig = [...rows].reverse().find(r => r.kind === 'signature');
  if (!sig) return '';
  return `<div class="evidence-saved"><b>✓ ${eEsc(label)} signed by ${eEsc(sig.created_by_name)}</b><div class="small">${new Date(sig.created_at).toLocaleString()}</div>${sig.signed_url ? `<img src="${eEsc(sig.signed_url)}" alt="Saved signature">` : ''}</div>`;
}

function signaturePad(prepId, stage, alreadySigned) {
  return `<div class="evidence-signature"><b>${stage === 'it' ? 'IT Handoff Signature' : 'Service Receipt Signature'}</b><div class="small">Sign with your finger. The app stamps your logged-in name and server date/time.</div><canvas class="evidence-canvas" data-prep-id="${prepId}" data-stage="${stage}"></canvas><div class="evidence-sig-actions"><button type="button" class="mini evidence-clear-signature">Clear</button><button type="button" class="mini evidence-save-signature">${alreadySigned ? 'Replace Saved Signature' : 'Save Signature'}</button></div></div>`;
}

function uploadPanel(prepId, stage) {
  const label = stage === 'it' ? 'IT Prep Photos' : 'Service Receipt Photos';
  const note = stage === 'it'
    ? 'Take clear photos of every unit and anything leaving with it—batteries, stands, accessories, or other prepared equipment.'
    : 'Photograph what you physically received from IT before leaving the shop so it can be compared to the IT handoff photos.';
  return `<div class="evidence-upload"><label>${label}</label><div class="small">${note}</div><input class="evidence-file-input top8" data-prep-id="${prepId}" data-stage="${stage}" type="file" accept="image/*" capture="environment" multiple><button type="button" class="mini full top8 evidence-upload-photos">Upload Selected Photo(s)</button></div>`;
}

function editableEvidencePanel(prepId, stage, rows) {
  const stageRows = rows.filter(r => r.stage === stage);
  const photos = stageRows.filter(r => r.kind === 'photo');
  const sig = stageRows.find(r => r.kind === 'signature');
  const title = stage === 'it' ? 'Photo & Signature Handoff' : 'Service Receipt Proof';
  const step = stage === 'it' ? 'STEP 3 — PROVE & SEND' : 'STEP 2 — PROVE RECEIPT';
  const note = stage === 'it'
    ? 'Service will see these photos before accepting the equipment. A photo and IT signature are required to send.'
    : 'Compare what you received to IT’s photos. A Service photo and signature are required before deployment.';
  return `<div class="evidence-panel ${stage === 'service' ? 'service' : ''}" data-evidence-prep="${prepId}" data-evidence-stage="${stage}"><div class="evidence-head"><b>${title}</b><span class="evidence-step">${step}</span></div><div class="evidence-note">${note}</div>${uploadPanel(prepId,stage)}<div class="top8"><b>${photos.length} photo${photos.length===1?'':'s'} saved</b>${photoGallery(stageRows)}</div>${savedSignature(stageRows, stage === 'it' ? 'IT handoff' : 'Service receipt')}${signaturePad(prepId,stage,!!sig)}<div class="evidence-lock ${photos.length && sig ? 'evidence-ready' : ''}">${photos.length && sig ? '✓ Required handoff proof is complete.' : `Required before ${stage === 'it' ? 'sending to Service' : 'deploying to field'}: at least 1 photo + signature.`}</div></div>`;
}

function readOnlyProof(title, rows, stage) {
  const stageRows = rows.filter(r => r.stage === stage);
  if (!stageRows.length) return `<div class="evidence-proof"><div class="evidence-proof-title">${eEsc(title)}</div><div class="small">No proof recorded yet.</div></div>`;
  return `<div class="evidence-proof"><div class="evidence-proof-title">${eEsc(title)}</div>${photoGallery(stageRows)}${savedSignature(stageRows, stage === 'it' ? 'IT handoff' : 'Service receipt')}</div>`;
}

function wireCanvas(canvas) {
  if (!canvas || canvas.dataset.wired === 'true') return;
  canvas.dataset.wired = 'true';
  const rect = canvas.getBoundingClientRect();
  const dpr = Math.max(1, window.devicePixelRatio || 1);
  const cssW = Math.max(250, rect.width || 300), cssH = 130;
  canvas.width = Math.round(cssW * dpr);
  canvas.height = Math.round(cssH * dpr);
  const ctx = canvas.getContext('2d');
  ctx.scale(dpr,dpr);
  ctx.lineWidth = 2.5;
  ctx.lineCap = 'round';
  ctx.lineJoin = 'round';
  ctx.strokeStyle = '#17212b';
  let drawing = false;
  const pt = ev => {
    const r = canvas.getBoundingClientRect();
    return { x: ev.clientX-r.left, y: ev.clientY-r.top };
  };
  canvas.addEventListener('pointerdown', ev => { drawing=true; canvas.setPointerCapture?.(ev.pointerId); const p=pt(ev); ctx.beginPath(); ctx.moveTo(p.x,p.y); ev.preventDefault(); });
  canvas.addEventListener('pointermove', ev => { if(!drawing)return; const p=pt(ev); ctx.lineTo(p.x,p.y); ctx.stroke(); canvas.dataset.hasInk='true'; ev.preventDefault(); });
  const stop = ev => { drawing=false; ev?.preventDefault?.(); };
  canvas.addEventListener('pointerup',stop); canvas.addEventListener('pointercancel',stop); canvas.addEventListener('pointerleave',stop);
}

async function uploadEvidence(prepId, stage, kind, file, originalName) {
  const { data: { session } } = await evidenceDb.auth.getSession();
  if (!session?.user?.id) throw new Error('Sign in again before uploading handoff evidence.');
  const extRaw = String(originalName || '').split('.').pop().toLowerCase();
  const ext = kind === 'signature' ? 'png' : (/^[a-z0-9]{2,6}$/.test(extRaw) ? extRaw : 'jpg');
  const path = `${session.user.id}/${prepId}/${stage}/${kind}-${Date.now()}-${crypto.randomUUID()}.${ext}`;
  const { error: uploadError } = await evidenceDb.storage.from(EVIDENCE_BUCKET).upload(path,file,{contentType:file.type || (kind==='signature'?'image/png':'image/jpeg'),upsert:false});
  if (uploadError) throw uploadError;
  const { error: recordError } = await evidenceDb.rpc('record_handoff_evidence',{p_prep_id:prepId,p_stage:stage,p_kind:kind,p_storage_path:path,p_original_name:originalName || null});
  if (recordError) {
    await evidenceDb.storage.from(EVIDENCE_BUCKET).remove([path]);
    throw recordError;
  }
}

async function canvasBlob(canvas) {
  return await new Promise(resolve => canvas.toBlob(resolve,'image/png',0.92));
}

async function renderEvidenceAll() {
  if (evidenceRendering || !evidenceDb) return;
  evidenceRendering = true;
  try {
    const { data: preps, error } = await evidenceDb.from('prep_tickets').select('id,ticket_no,status');
    if (error) return;
    const byTicket = new Map((preps||[]).map(p => [eNormalize(p.ticket_no),p]));

    if (eIT()) {
      for (const card of document.querySelectorAll('#itPreps .item.prepared[data-prep-id]')) {
        const prepId = card.dataset.prepId;
        if (!prepId || card.querySelector('.evidence-panel[data-evidence-stage="it"]')) continue;
        const rows = await evidenceRows(prepId);
        const actionRow = [...card.querySelectorAll('.row')].reverse().find(r => r.querySelector('.cos-send-service'));
        if (actionRow) actionRow.insertAdjacentHTML('beforebegin', editableEvidencePanel(prepId,'it',rows));
        const ready = rows.some(r=>r.stage==='it'&&r.kind==='photo') && rows.some(r=>r.stage==='it'&&r.kind==='signature');
        const send = card.querySelector('.cos-send-service');
        if (send) { send.disabled=!ready; send.classList.toggle('evidence-disabled',!ready); send.title=ready?'':'Upload at least one IT photo and save the IT signature first.'; }
      }
    }

    if (eService()) {
      for (const card of document.querySelectorAll('#matchedPreps > .item.prepared')) {
        if (card.dataset.evidenceReady === 'true') continue;
        const raw = (card.querySelector('.ticketHead b')?.textContent || '').replace(/^.*?#/,'');
        const prep = byTicket.get(eNormalize(raw));
        if (!prep) continue;
        card.dataset.evidenceReady='true';
        card.dataset.prepId=prep.id;
        const rows = await evidenceRows(prep.id);
        const button = [...card.querySelectorAll('button')].find(b => /Complete Equipment Checkout Verification|Deployed|Verification/i.test(b.textContent));
        const markup = readOnlyProof('IT Handoff Proof — Compare Before Accepting',rows,'it') + editableEvidencePanel(prep.id,'service',rows);
        if (button) button.insertAdjacentHTML('beforebegin',markup); else card.insertAdjacentHTML('beforeend',markup);
        const ready = rows.some(r=>r.stage==='service'&&r.kind==='photo') && rows.some(r=>r.stage==='service'&&r.kind==='signature');
        if (button) { button.disabled=!ready; button.classList.toggle('evidence-disabled',!ready); button.title=ready?'':'Upload at least one Service receipt photo and save the Service signature first.'; }
      }
    }

    document.querySelectorAll('.evidence-canvas').forEach(wireCanvas);
  } finally { evidenceRendering=false; }
}

function scheduleEvidenceRender() {
  clearTimeout(evidenceTimer);
  evidenceTimer=setTimeout(renderEvidenceAll,90);
}

function observeEvidenceContainer(id) {
  const node=document.getElementById(id);
  if(!node || node.dataset.evidenceObserved==='true')return;
  node.dataset.evidenceObserved='true';
  new MutationObserver(scheduleEvidenceRender).observe(node,{childList:true});
}

document.addEventListener('click', async ev => {
  const upload = ev.target.closest('.evidence-upload-photos');
  if (upload) {
    const panel=upload.closest('.evidence-panel'), input=panel?.querySelector('.evidence-file-input');
    const files=[...(input?.files||[])];
    if(!files.length)return alert('Take or select at least one photo first.');
    upload.disabled=true; upload.textContent='Uploading…';
    try {
      for(const file of files) await uploadEvidence(panel.dataset.evidencePrep,panel.dataset.evidenceStage,'photo',file,file.name);
      panel.remove();
      await renderEvidenceAll();
    } catch(err) { alert(err?.message || 'Photo upload failed.'); upload.disabled=false; upload.textContent='Upload Selected Photo(s)'; }
    return;
  }
  const clear = ev.target.closest('.evidence-clear-signature');
  if(clear){const canvas=clear.closest('.evidence-signature')?.querySelector('canvas');if(canvas){const ctx=canvas.getContext('2d');ctx.clearRect(0,0,canvas.width,canvas.height);canvas.dataset.hasInk='';}return;}
  const save = ev.target.closest('.evidence-save-signature');
  if(save){const box=save.closest('.evidence-signature'), canvas=box?.querySelector('canvas');if(!canvas||canvas.dataset.hasInk!=='true')return alert('Sign in the signature box with your finger first.');save.disabled=true;save.textContent='Saving signature…';try{const blob=await canvasBlob(canvas);if(!blob)throw new Error('Could not capture signature.');await uploadEvidence(canvas.dataset.prepId,canvas.dataset.stage,'signature',blob,'signature.png');const panel=save.closest('.evidence-panel');panel?.remove();await renderEvidenceAll();}catch(err){alert(err?.message||'Signature could not be saved.');save.disabled=false;save.textContent='Save Signature';}return;}
});

function evidenceInstall(){installEvidenceStyles();observeEvidenceContainer('itPreps');observeEvidenceContainer('matchedPreps');scheduleEvidenceRender();setTimeout(()=>{observeEvidenceContainer('itPreps');observeEvidenceContainer('matchedPreps');scheduleEvidenceRender();},400);}
if(document.readyState==='loading')document.addEventListener('DOMContentLoaded',evidenceInstall);else evidenceInstall();
