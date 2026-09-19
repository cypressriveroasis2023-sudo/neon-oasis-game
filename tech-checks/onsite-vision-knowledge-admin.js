/* Cameras On Site — OnSite Vision Managed Knowledge Client
 * Version: knowledge-admin-v1
 */
(function(root){
  'use strict';
  let client=null;

  function configure(supabaseClient){
    client=supabaseClient;
    return api;
  }
  function requireClient(){
    if(!client)throw new Error('OnSite Vision knowledge manager is not configured.');
  }
  async function list(status='',limit=100){
    requireClient();
    const response=await client.rpc('vision_list_knowledge_v1',{
      p_status:String(status||''),
      p_limit:Number(limit||100)
    });
    if(response.error)throw response.error;
    return Array.isArray(response.data)?response.data:[];
  }
  async function save(entry){
    requireClient();
    const response=await client.rpc('vision_save_knowledge_entry_v1',{
      p_entry_id:entry?.id||null,
      p_entry:{
        title:String(entry?.title||''),
        domain:String(entry?.domain||'technical'),
        equipment_type:String(entry?.equipment_type||''),
        workflow_type:String(entry?.workflow_type||''),
        topic:String(entry?.topic||''),
        content:String(entry?.content||''),
        status:String(entry?.status||'draft'),
        source_kind:String(entry?.source_kind||'owner'),
        source_ref:String(entry?.source_ref||''),
        tags:Array.isArray(entry?.tags)?entry.tags:[]
      }
    });
    if(response.error)throw response.error;
    return response.data;
  }
  async function search(query,{equipment_type='',workflow_type='',limit=12}={}){
    requireClient();
    const response=await client.rpc('vision_search_knowledge_v1',{
      p_query:String(query||''),
      p_equipment_type:String(equipment_type||''),
      p_workflow_type:String(workflow_type||''),
      p_limit:Number(limit||12)
    });
    if(response.error)throw response.error;
    return Array.isArray(response.data)?response.data:[];
  }

  const api=Object.freeze({
    version:'knowledge-admin-v1',
    configure,
    list,
    save,
    search
  });
  root.OnSiteVisionKnowledgeAdmin=api;
})(typeof window!=='undefined'?window:globalThis);
