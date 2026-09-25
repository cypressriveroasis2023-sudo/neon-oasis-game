// Shared IT Prep persistence.
// Keeps equipment-specific draft writes out of the UI/controller module.
function isHeliosDeploy(item){
  return window.TechCheckRules?.isHeliosDeploy
    ? window.TechCheckRules.isHeliosDeploy(item)
    : (item?.equipment_type==='Helios' && ['DELIVERY','SWAP','BACKUP'].includes(item?.purpose));
}
async function saveItem(item){
  const ctx=window.TechCheckContext;if(!ctx?.db)throw new Error('Tech Check application context is not ready.');
  if(!item?.id)throw new Error('IT prep item is not available.');
  if(['Spotter','Recon 2','Ranger'].includes(item.equipment_type)){
    const {error}=await ctx.db.rpc('save_it_camera_family_checks_v1',{
      p_item_id:item.id,p_programmed_ok:Boolean(item.unit_programmed_ok),p_port_81_ok:Boolean(item.camera_port_81_ok),
      p_port_554_ok:Boolean(item.camera_port_554_ok),p_recon_camera_count:item.equipment_type==='Recon 2'?Math.max(1,Number(item.recon_camera_count||1)):null
    });if(error)throw error;
  }
  const {error}=await ctx.db.rpc('save_it_prep_item_draft',{
    p_item_id:item.id,p_unit_tag:item.unit_tag||'',p_battery_count:Number(item.battery_count||0),
    p_power_ok:Boolean(item.power_ok),p_functions_ok:Boolean(item.functions_ok),p_safe_ok:Boolean(item.safe_ok),
    p_sim_ok:Boolean(item.delivery_sim_ok),p_camera_app_ok:Boolean(item.delivery_camera_app_ok),
    p_customer_email_app_ok:Boolean(item.delivery_customer_email_app_ok),p_batteries_charged_ok:Boolean(item.delivery_batteries_charged_ok),
    p_monitoring_ok:Boolean(item.delivery_monitoring_ok),p_ticket_count_ok:Boolean(item.delivery_ticket_count_ok),
    p_sd_formatted_ok:Boolean(item.delivery_sd_formatted_ok),p_recording_ok:Boolean(item.delivery_recording_ok),
    p_mppt_updated_ok:Boolean(item.solar_mppt_updated_ok),p_mppt_tested_ok:Boolean(item.solar_mppt_tested_ok),
    p_pv_charging_ok:Boolean(item.solar_pv_charging_ok),p_solar_panels_match_ok:Boolean(item.solar_panels_match_ok),
    p_ticket_item_match_ok:Boolean(item.ticket_item_match_ok)
  });if(error)throw error;
  if(isHeliosDeploy(item)){
    const {error}=await ctx.db.rpc('save_it_helios_deploy_checks_v1',{
      p_item_id:item.id,p_camera1_hardware_ok:Boolean(item.helios_camera1_hardware_ok),p_camera2_hardware_ok:Boolean(item.helios_camera2_hardware_ok),
      p_ptz_assembly_ok:Boolean(item.helios_ptz_assembly_ok),p_proxicast_4x4_ok:Boolean(item.helios_proxicast_4x4_ok),
      p_router_sim_ok:Boolean(item.helios_router_sim_ok),p_speaker_24v_ok:Boolean(item.helios_speaker_24v_ok),
      p_cameras_12v_ok:Boolean(item.helios_cameras_12v_ok),p_ptz_plate_4bolts_ok:Boolean(item.helios_ptz_plate_4bolts_ok),
      p_cerbo_network_ok:Boolean(item.helios_cerbo_network_ok),p_cerbo_vrm_ok:Boolean(item.helios_cerbo_vrm_ok),
      p_rear_unit_tag_ok:Boolean(item.helios_rear_unit_tag_ok),p_battery_box_installed_ok:Boolean(item.helios_battery_box_installed_ok),
      p_battery_120v_charged_ok:Boolean(item.helios_battery_120v_charged_ok),p_camera_router_programming_ok:Boolean(item.helios_camera_router_programming_ok),
      p_alibi_vigilant_ok:Boolean(item.helios_alibi_vigilant_ok),p_3x1tb_sd_ok:Boolean(item.helios_3x1tb_sd_ok),
      p_camera1_ports_ok:Boolean(item.helios_camera1_ports_ok),p_camera2_ports_ok:Boolean(item.helios_camera2_ports_ok),
      p_ptz_ports_ok:Boolean(item.helios_ptz_ports_ok),p_speaker_ports_ok:Boolean(item.helios_speaker_ports_ok),
      p_sim_ok:Boolean(item.delivery_sim_ok),p_camera_app_ok:Boolean(item.delivery_camera_app_ok),
      p_customer_email_app_ok:Boolean(item.delivery_customer_email_app_ok),p_monitoring_ok:Boolean(item.delivery_monitoring_ok),
      p_sd_formatted_ok:Boolean(item.delivery_sd_formatted_ok),p_recording_ok:Boolean(item.delivery_recording_ok)
    });if(error)throw error;
  }
  return true;
}
window.TechCheckITPrep=Object.freeze({saveItem,isHeliosDeploy});
