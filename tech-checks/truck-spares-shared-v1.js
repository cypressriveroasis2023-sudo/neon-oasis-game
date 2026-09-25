// Shared truck-spare reads used by both IT Prep and Service handoff flows.
async function load(prepId){
  const ctx=window.TechCheckContext;
  if(!ctx?.db)throw new Error('Tech Check application context is not ready.');
  if(!prepId)return [];
  const {data,error}=await ctx.db.from('truck_spare_batteries')
    .select('*')
    .eq('prep_ticket_id',prepId)
    .order('created_at',{ascending:true});
  if(error)throw error;
  return data||[];
}

window.TechCheckTruckSpares=Object.freeze({load});
