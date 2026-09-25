// IT Prep presentation helpers.
// Pure markup only: no database writes and no workflow transitions.
function stepHtml(item,step,index,total,unitNo,deps={}){
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
window.TechCheckITPrepView=Object.freeze({stepHtml});
