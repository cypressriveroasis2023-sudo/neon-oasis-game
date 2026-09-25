// Shared IT / Service handoff evidence presentation.
// Keeps photo and signature markup out of the technician/owner workflow controller.
async function photoOnlyHtml(prepId,stage,unitNo=null,expectedCount=null,deps={}){
  const evidenceRows=deps.evidenceRows||(async()=>[]),esc=deps.esc||((value)=>String(value??''));
  const rows=await evidenceRows(prepId,stage);
  const prefix=unitNo?`unit-${unitNo}-`:'';
  const photos=rows.filter(r=>r.kind==='photo'&&(!unitNo||String(r.original_name||'').startsWith(prefix)));
  const required=unitNo?1:Math.max(1,Number(expectedCount||1));
  const item=stage==='it'&&unitNo?(deps.itItems?.()||[])[unitNo-1]||null:null;
  const identity=item?(deps.itemIdentity?.(item,unitNo)||`Unit ${unitNo}`):`Unit ${unitNo}`;
  const tag=String(item?.unit_tag||'').trim();
  const complete=photos.length===required;
  const shouldScanUnitTag=deps.shouldScanUnitTag||(()=>false),itemTagScan=deps.itemTagScan||(()=>null);
  const aiScan=stage==='it'&&unitNo&&photos.length&&shouldScanUnitTag(item?.equipment_type)?itemTagScan(item):null;
  const aiMismatch=aiScan?.status==='mismatch';

  const shortInstruction=unitNo
    ? (stage==='it'&&tag?`Take 1 clear photo. Make sure tag ${tag} is visible.`:`Take 1 clear photo of ${identity}.`)
    : stage==='service'
      ? `Take ${required} clear receipt photo${required===1?'':'s'}.`
      : 'Take a clear photo of what is leaving the shop.';

  let picker='';
  if(stage==='service'){
    picker=`<div class='wl-photo-step'>
      <div class='wl-photo-step-num'>STEP 1</div>
      <div class='wl-photo-step-title'>Choose Photo</div>
      <div class='small'>${esc(shortInstruction)}</div>
      <div class='wl-solar-photo-actions'>
        <label class='wl-solar-photo-choice'><span>📷</span><b>TAKE PHOTO</b><input class='wl-file wl-solar-file-hidden' type='file' accept='image/*' capture='environment'></label>
        <label class='wl-solar-photo-choice'><span>▣</span><b>PHOTO LIBRARY</b><input class='wl-file wl-solar-file-hidden' type='file' accept='image/*' multiple></label>
      </div>
      <div class='wl-photo-selected' data-wl-photo-selected>${complete?'Photo already saved.':'No photo selected yet.'}</div>
    </div>
    <div class='wl-photo-step'>
      <div class='wl-photo-step-num'>STEP 2</div>
      <div class='wl-photo-step-title'>Save Photo</div>
      <div class='small'>Save the photo before moving on.</div>
      <button class='wl-photo-save' data-wl-upload='${stage}' disabled>${complete?'Save New Photo':'Save Photo'}</button>
    </div>`;
  }else{
    const captureAttr=" capture='environment'";
    picker=`<div class='wl-photo-step'>
      <div class='wl-photo-step-num'>STEP 1</div>
      <div class='wl-photo-step-title'>Choose Photo</div>
      <div class='small'>${esc(shortInstruction)}</div>
      <label class='wl-photo-picker'>
        <input class='wl-file' type='file' accept='image/*'${captureAttr} ${unitNo?'':'multiple'}>
        <span>${complete?'Choose a New Photo':'Choose Photo'}</span>
      </label>
      <div class='wl-photo-selected' data-wl-photo-selected>${complete?'Photo already saved.':'No photo selected yet.'}</div>
    </div>
    <div class='wl-photo-step'>
      <div class='wl-photo-step-num'>STEP 2</div>
      <div class='wl-photo-step-title'>Save Photo</div>
      <div class='small'>Save the photo before moving on.</div>
      <button class='wl-photo-save' data-wl-upload='${stage}' disabled>${complete?'Save New Photo':'Save Photo'}</button>
    </div>`;
  }

  let tagConfirm='';
  if(stage==='it'&&unitNo&&photos.length&&tag){
    if(aiMismatch){
      tagConfirm=`<div class='wl-stop top10'><b>WRONG TAG</b><div>This photo does not match tag ${esc(tag)}. Choose a new photo.</div></div>`;
    }else if(!item?.photo_tag_match_ok){
      tagConfirm=`<div class='wl-photo-step wl-photo-confirm'>
        <div class='wl-photo-step-num'>STEP 3</div>
        <div class='wl-photo-step-title'>Check the Tag</div>
        <div class='small'>Can you clearly see tag ${esc(tag)}?</div>
        <div class='wl-options'><button class='fail' data-wl-photo-tag='no'>RETAKE</button><button class='pass' data-wl-photo-tag='yes'>YES</button></div>
      </div>`;
    }else{
      tagConfirm=`<div class='ok top10'><b>✓ Tag ${esc(tag)} confirmed</b></div>`;
    }
  }

  return `<div class='wl-proof wl-photo-simple ${stage==='service'?'service':''}' data-proof='${prepId}' data-stage='${stage}' data-mode='photo' data-unit='${unitNo||''}' data-expected='${required}'>
    <div class='wl-photo-title'>${stage==='it'&&unitNo?esc(identity):unitNo?`Unit ${unitNo}`:'Photo'}</div>
    <div class='wl-photo-status ${complete?'done':''}'>${complete?'✓ Photo saved':'No photo saved yet'}</div>
    ${photos.length?`<div class='wl-gallery'>${photos.map(p=>`<img src='${esc(p.url)}' alt='Saved photo'>`).join('')}</div>`:''}
    ${picker}
    ${tagConfirm}
  </div>`;
}

async function signatureOnlyHtml(prepId,stage,unitNo=null,deps={}){
  const evidenceRows=deps.evidenceRows||(async()=>[]),signatureStamp=deps.signatureStamp||((name)=>`Signed by ${name||'Technician'}`);
  const rows=await evidenceRows(prepId,stage);
  const signatureName=unitNo?`unit-${unitNo}-signature.png`:null;
  const sig=[...rows].reverse().find(r=>r.kind==='signature'&&(!unitNo||r.original_name===signatureName));
  if(sig){
    return `<div class='wl-proof wl-sign-simple ${stage==='service'?'service':''}' data-proof='${prepId}' data-stage='${stage}' data-mode='signature' data-unit='${unitNo||''}'>
      <div class='wl-photo-title'>Signature</div>
      <div class='ok'><b>✓ Signature saved</b><div class='small'>${signatureStamp(sig.created_by_name||(stage==='it'?'IT Technician':'Service Tech'),sig.created_at)}</div></div>
      <button class='mini full top10' data-wl-replace='${stage}'>Sign Again</button>
    </div>`;
  }
  return `<div class='wl-proof wl-sign-simple ${stage==='service'?'service':''}' data-proof='${prepId}' data-stage='${stage}' data-mode='signature' data-unit='${unitNo||''}'>
    <div class='wl-photo-title'>Sign Here</div>
    <div class='small'>Sign inside the box with your finger.</div>
    <div class='wl-sign top10'><canvas></canvas>
      <div class='wl-nav'><button class='wl-prev' data-wl-clear>Clear</button><button class='wl-next' data-wl-save-sign='${stage}'>Save Signature</button></div>
    </div>
  </div>`;
}

window.TechCheckEvidenceView=Object.freeze({photoOnlyHtml,signatureOnlyHtml});
