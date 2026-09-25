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
async function saveProgress({returnId,notes='',meta={}}){
  const ctx=window.TechCheckContext;if(!ctx?.db)throw new Error('Tech Check application context is not ready.');
  const damage_notes=writeRecord(notes,meta),updated_at=new Date().toISOString();
  const {error}=await ctx.db.from('unit_returns').update({damage_notes,updated_at}).eq('id',returnId);
  if(error)throw error;
  return {damage_notes,updated_at};
}
async function finishIntake({row,tech,notes='',meta={},intakePhotoPaths=[]}){
  const ctx=window.TechCheckContext;if(!ctx?.db)throw new Error('Tech Check application context is not ready.');
  const now=new Date().toISOString();
  const nextMeta={...(meta||{})};
  if(!nextMeta.cancellationDoc)nextMeta.cancellationDoc=documentation(row,tech,new Date(now));
  const {error}=await ctx.db.from('unit_returns').update({status:'pending_mhelp_inventory',it_tech_id:tech.id,it_tech_name:tech.name,it_received_at:now,damage_notes:writeRecord(notes,nextMeta),intake_photo_paths:intakePhotoPaths,updated_at:now}).eq('id',row.id);
  if(error)throw error;
  return {status:'pending_mhelp_inventory',meta:nextMeta,updated_at:now};
}
async function markNeedsReplacement({returnId,damageNotes,intakePhotoPaths=[]}){
  const ctx=window.TechCheckContext;if(!ctx?.db)throw new Error('Tech Check application context is not ready.');
  const {error}=await ctx.db.rpc('it_mark_return_needs_replacement_v1',{p_return_id:returnId,p_damage_notes:String(damageNotes||'').trim(),p_intake_photo_paths:intakePhotoPaths});
  if(error)throw error;
  return {status:'needs_replacement'};
}
async function confirmMHelpInventory(returnId){
  const ctx=window.TechCheckContext;if(!ctx?.db)throw new Error('Tech Check application context is not ready.');
  const now=new Date().toISOString();
  const {error}=await ctx.db.from('unit_returns').update({status:'completed',mhelp_inventory_confirmed:true,mhelp_confirmed_at:now,completed_at:now,updated_at:now}).eq('id',returnId);
  if(error)throw error;
  return {status:'completed',updated_at:now};
}

window.TechCheckIntake=Object.freeze({readRecord,writeRecord,documentation,saveProgress,finishIntake,markNeedsReplacement,confirmMHelpInventory});
