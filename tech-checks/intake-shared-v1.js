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
  const payload={status:'pending_mhelp_inventory',it_tech_id:tech.id,it_tech_name:tech.name,it_received_at:now,damage_notes:writeRecord(notes,nextMeta),intake_photo_paths:intakePhotoPaths,updated_at:now};
  const expectedPaths=[...(intakePhotoPaths||[])].map(String).sort();
  const matchesSaved=rowData=>{
    if(!rowData||rowData.status!=='pending_mhelp_inventory'||String(rowData.it_tech_id||'')!==String(tech.id||''))return false;
    const actualPaths=[...(rowData.intake_photo_paths||[])].map(String).sort();
    return actualPaths.length===expectedPaths.length&&actualPaths.every((value,index)=>value===expectedPaths[index]);
  };
  let saved=null;
  let writeError=null;
  try{
    const result=await ctx.db.from('unit_returns')
      .update(payload)
      .eq('id',row.id)
      .select('id,status,it_tech_id,intake_photo_paths,updated_at')
      .maybeSingle();
    saved=result.data||null;
    writeError=result.error||null;
  }catch(error){
    writeError=error;
  }
  if(matchesSaved(saved))return {status:'pending_mhelp_inventory',meta:nextMeta,updated_at:saved.updated_at||now};
  if(writeError){
    let confirmed=null,verifyError=null;
    try{
      const check=await ctx.db.from('unit_returns')
        .select('id,status,it_tech_id,intake_photo_paths,updated_at')
        .eq('id',row.id)
        .maybeSingle();
      confirmed=check.data||null;
      verifyError=check.error||null;
    }catch(error){
      verifyError=error;
    }
    if(matchesSaved(confirmed))return {status:'pending_mhelp_inventory',meta:nextMeta,updated_at:confirmed.updated_at||now};
    if(verifyError)throw new Error('Connection was interrupted while finishing IT Intake. Tech Check could not safely verify the result. Reconnect and reopen this return; the saved database status will decide what step is next.');
    throw writeError;
  }
  throw new Error('IT Intake was not confirmed by Supabase. Reload this return before continuing; it has not been treated as complete.');
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
  const payload={status:'completed',mhelp_inventory_confirmed:true,mhelp_confirmed_at:now,completed_at:now,updated_at:now};
  const verifyCompleted=async()=>{
    const check=await ctx.db.from('unit_returns')
      .select('id,status,mhelp_inventory_confirmed,mhelp_confirmed_at,completed_at,updated_at')
      .eq('id',returnId)
      .maybeSingle();
    if(check.error)throw check.error;
    return check.data||null;
  };
  let saved=null,writeError=null;
  try{
    const result=await ctx.db.from('unit_returns')
      .update(payload)
      .eq('id',returnId)
      .eq('status','pending_mhelp_inventory')
      .select('id,status,mhelp_inventory_confirmed,mhelp_confirmed_at,completed_at,updated_at')
      .maybeSingle();
    saved=result.data||null;
    writeError=result.error||null;
  }catch(error){
    writeError=error;
  }
  if(saved?.status==='completed'&&saved.mhelp_inventory_confirmed===true)return {status:'completed',updated_at:saved.updated_at||now,alreadyCompleted:false};
  let confirmed=null;
  try{confirmed=await verifyCompleted();}
  catch(error){
    if(writeError)throw new Error('Connection was interrupted while confirming MHelpDesk inventory and Tech Check could not verify the saved status. Reconnect and reopen Return & Intake Tracking before trying again.');
    throw error;
  }
  if(confirmed?.status==='completed'&&confirmed.mhelp_inventory_confirmed===true)return {status:'completed',updated_at:confirmed.updated_at||now,alreadyCompleted:true};
  if(writeError)throw writeError;
  throw new Error('This return is no longer waiting for Owner MHelpDesk inventory confirmation. Refresh Return & Intake Tracking before continuing.');
}

window.TechCheckIntake=Object.freeze({readRecord,writeRecord,documentation,saveProgress,finishIntake,markNeedsReplacement,confirmMHelpInventory});
