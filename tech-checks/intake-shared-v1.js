// Shared return / IT Intake record helpers.
// Keeps the chain-of-custody record format authoritative across IT and Owner views.
const INTAKE_META_RE=/(?:^|\n)\[\[INTAKE_META:([A-Za-z0-9+/=]+)\]\]/;

function readRecord(raw){
  const text=String(raw||''),match=text.match(INTAKE_META_RE); let meta={};
  if(match?.[1]){try{meta=JSON.parse(atob(match[1]));}catch{meta={};}}
  return {notes:text.replace(INTAKE_META_RE,'').trim(),meta};
}
function writeRecord(notes,meta){
  const payload=btoa(JSON.stringify(meta||{})),clean=String(notes||'').trim();
  return clean+(clean?'\n':'')+'[[INTAKE_META:'+payload+']]';
}
function techInitials(name){
  return String(name||'IT').trim().split(/\s+/).filter(Boolean).map(part=>part[0]).join('').slice(0,4).toUpperCase()||'IT';
}
function documentation(row,tech,at=new Date()){
  return {simCanceledDate:at.toLocaleDateString(),ticket:String(row?.ticket_no||''),unit:String(row?.unit_tag||''),techInitials:techInitials(tech?.name),techName:String(tech?.name||'IT Technician')};
}
async function syncAssignmentAfterIntake(ticket,techId){
  const ctx=window.TechCheckContext;if(!ctx?.db)throw new Error('Tech Check application context is not ready.');
  const {data:rows}=await ctx.db.from('job_assignments').select('*').eq('ticket_no',String(ticket||'')).eq('assigned_role','it').eq('assignee_user_id',techId).in('status',['assigned','started']).order('assigned_at',{ascending:false}).limit(1);
  const assignment=rows?.[0]; if(!assignment)return {completed:false,reason:'no_assignment'};
  const manifest=Array.isArray(assignment.equipment_manifest)?assignment.equipment_manifest:[];
  const manifestTotal=manifest.reduce((sum,item)=>sum+Math.max(0,Number(item?.qty??item?.quantity??1)||0),0);
  const required=Math.max(1,Number(assignment.requested_unit_count??manifestTotal??1)||1);
  const {data:returns}=await ctx.db.from('unit_returns').select('id,status').eq('ticket_no',String(ticket||''));
  const processed=(returns||[]).filter(r=>['pending_mhelp_inventory','needs_replacement','completed'].includes(r.status)).length;
  return {completed:processed>=required,processed,required,assignment};
}
window.TechCheckIntake=Object.freeze({readRecord,writeRecord,documentation,syncAssignmentAfterIntake});
