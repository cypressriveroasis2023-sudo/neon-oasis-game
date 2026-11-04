/** Called only after the existing fleet account authorization. */
export async function savedFleetBoard({rpc,read,force=false,waitUntil,now=Date.now,project,abort}){
 const lease=await rpc('cos_fleet_board_begin',{p_force:force});
 if(lease?.id){
  const work=(async()=>{
   try{
    const before=await rpc('cos_fleet_board_read',{});
    const [health,map,connections]=await Promise.all([read('/api/camera-health/summary-v3'),read('/api/field-map'),read('/api/product-connections')]);
    const value=project(health,map,connections,before?.latest?.payload,now());
    if(!await rpc('cos_fleet_board_finish',{p_run:lease.id,p_payload:value}))throw Error('commit_unconfirmed');
   }catch(cause){
    abort?.();
    const code=['checks_incomplete','connection_source_incomplete','inventory_source_incomplete'].includes(cause?.message)?cause.message:'source_read_failed';
    await rpc('cos_fleet_board_fail',{p_run:lease.id,p_code:code,p_products:Array.isArray(cause?.products)?cause.products.slice(0,1000):[]}).catch(()=>{});
   }
  })();
  waitUntil(work);
 }
 return rpc('cos_fleet_board_read',{});
}
