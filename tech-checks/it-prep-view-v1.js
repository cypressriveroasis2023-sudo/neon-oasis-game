// IT Prep presentation helpers.
// Pure markup only: no database writes and no workflow transitions.
function stepHtml,equipmentReviewHtml,ticketSummaryHtml,partsSummaryHtml,spareSummaryHtml,finalLockHtml(item,step,index,total,unitNo,deps={}){
  const esc=deps.esc||((v)=>String(v??''));const boolAnswered=deps.boolAnswered||(()=>false),boolValue=deps.boolValue||(()=>false);
  if(step.kind==='tag'){
    const type=String(item?.equipment_type||'unit'),example=type==='Helios'?'Example: 007.':'Enter the tag exactly as printed on the equipment.';
    return `<div class='wl-question'><div class='qnum'>UNIT ${unitNo} · STEP ${index+1} OF ${total}</div><div class='qtext'>${esc(step.label)}</div><input id='wlItUnitValue' value='${esc(item.unit_tag||'')}' placeholder='${step.optional?'ENTER TAG IF PRESENT':'EXACT UNIT TAG'}'>${step.optional?"<div class='wl-note top8'>No tag is valid for a 110V Stand. Leave this blank if the stand does not have one.</div>":`<details class='wl-step-help top8'><summary>Need help?</summary><div class='wl-note top8'>Type the unit number exactly as it appears on the ${esc(type)}. ${esc(example)} Do not guess.</div></details>`}</div>`;
  }
  if(step.kind==='number'){
    const min=Number(step.min??(step.field==='battery_count'?item.required_battery_count:1)??1),value=item[step.field]??(step.field==='battery_count'?item.required_battery_count:min),helios=step.field==='battery_count'&&item?.equipment_type==='Helios';
    const label=helios?'Confirm 1 Helios battery box is prepared':step.label,note=helios?'Helios uses one internal battery box. Do not count Solar Stand batteries.':`Required minimum: ${min}`;
    return `<div class='wl-question'><div class='qnum'>UNIT ${unitNo} · STEP ${index+1} OF ${total}</div><div class='qtext'>${esc(label)}</div><input id='wlItUnitValue' type='number' inputmode='numeric' min='${min}' value='${esc(value??'')}'><div class='wl-note top8'>${esc(note)}</div></div>`;
  }
  const answered=boolAnswered(item,step.field),value=boolValue(item,step.field),yes=answered&&value===true,no=answered&&value!==true;
  return `<div class='wl-question wl-it-auto-bool'><div class='qnum'>UNIT ${unitNo} · STEP ${index+1} OF ${total}</div><div class='qtext'>${esc(step.label)}</div><div class='wl-options'><button class='pass ${yes?'on':''}' data-wl-it-answer='yes'>YES</button><button class='fail ${no?'on':''}' data-wl-it-answer='no'>NO</button></div>${no?`<div class='wl-stop'><b>STOP — FIX THIS FIRST.</b><div>When the problem is corrected, tap YES. This equipment cannot move forward while this answer is NO.</div></div>`:''}</div>`;
}
function equipmentReviewHtml(item,ev,unitNo,deps={}){
  const esc=deps.esc||((x)=>String(x??'')),type=String(item?.equipment_type||deps.typeChoice||'Equipment'),issues=item?deps.issues(item,ev||[],unitNo):[],flags=[],low=type.toLowerCase();
  if(low.includes('helios'))flags.push('Helios focus: cameras → modem → antenna → camera/modem programming → ports/configuration; verify 3 × 1TB SD cards.');
  if(low.includes('solar spotter'))flags.push('Solar Spotter IT check does not include battery checkout. The Solar Stand and its battery setup are verified on the Service side (4 × AGM 12V 110Ah or 1 × 12V 350Ah per stand).');
  if(low.includes('ranger'))flags.push('Ranger: verify MPPT update, MPPT operation, and charging. Service should receive 1 solar panel per Ranger.');
  if(low.includes('helios'))flags.push('Verify Camera 1: 81/554/1400 · Camera 2: 81/554/1500 · PTZ: 81/554/1600 · IP Speaker: 81/554/1700.');
  return `<div class='wl-ai-panel wl-ai-equipment'><div class='wl-ai-head'>${deps.title('Equipment Check')}<b>${issues.length?'VERIFY '+issues.length+' ITEM'+(issues.length===1?'':'S'):'ON TRACK'}</b></div><div class='wl-ai-line'><b>${esc(type)}</b> · Item ${unitNo}</div>${flags.length?`<div class='wl-ai-line'>${flags.map(x=>'• '+esc(x)).join('<br>')}</div>`:''}${issues.length?`<div class='wl-ai-warn'>${issues.slice(0,5).map(x=>'⚠ '+esc(x.label||x.message||x.phase||'Required check incomplete')).join('<br>')}</div>`:`<div class='wl-ai-good'>✓ No required-item conflicts detected at this point.</div>`}<div class='small top8'>AI Assist does not answer checks or approve equipment for the technician.</div></div>`;
}
function ticketSummaryHtml(prep,items,deps={}){
  const esc=deps.esc||((x)=>String(x??'')),units=items.map((item,index)=>({item,index})).filter(r=>r.item.purpose!=='BACKUP').map(({item,index})=>`<div class='wl-simple-unit'><div><b>${esc(item.equipment_type)} ${esc(item.unit_tag||'')}</b><span>Unit ${index+1} · ${esc(item.purpose)}</span></div><div class='wl-simple-unit-ok'>✓ READY</div><button class='mini' data-wl-final-unit='${index}'>Review / Adjust Unit</button></div>`).join('');
  return `<div class='wl-simple-ticket'><div class='wl-simple-ticket-number'>MHelpDesk #${esc(prep.ticket_no)}</div><div class='small'>${esc(prep.site||'')}</div></div><div class='wl-simple-units'>${units||"<div class='small'>No equipment prepared yet.</div>"}</div>`;
}
function partsSummaryHtml(prep,deps={}){
 const esc=deps.esc||((x)=>String(x??'')),rows=deps.partsRows(prep).filter(r=>r.qty>0);if(!rows.length)return '';
 return `<div class='wl-simple-extra wl-readonly-extra'><div class='qnum'>ASSIGNED LOOSE PARTS</div><div><b>${rows.map(r=>r.qty+' × '+esc(r.label)).join(' · ')}</b></div><div class='small'>ASSIGNED — READ ONLY</div></div>`;
}
function spareSummaryHtml(items,rows,deps={}){
 const esc=deps.esc||((x)=>String(x??'')),units=(items||[]).filter(i=>i.purpose==='BACKUP'),batteries=(rows||[]).filter(r=>Number(r.qty_prepared||0)>0),bits=[];
 if(units.length)bits.push(units.map(i=>esc(i.equipment_type)+' '+esc(i.unit_tag||'')).join(' · '));if(batteries.length)bits.push(batteries.map(r=>Number(r.qty_prepared)+' × '+esc(r.battery_type)).join(' · '));if(!bits.length)return '';
 return `<div class='wl-simple-extra wl-readonly-extra'><div class='qnum'>ASSIGNED TRUCK SPARES / BACKUPS</div><div><b>${bits.join(' · ')}</b></div><div class='small'>ASSIGNED — READ ONLY</div></div>`;
}
function finalLockHtml(){return `<div class='wl-it-final-lock'><b>✓ TICKET CONTENTS LOCKED</b><span>At handoff, IT can only review or correct a unit check. Equipment, parts, and spares cannot be added from this screen.</span></div>`;}

window.TechCheckITPrepView=Object.freeze({stepHtml});
