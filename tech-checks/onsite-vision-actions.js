/* Cameras On Site — OnSite Vision Action Layer
 * Version: action-layer-v1
 * Prepares, confirms and audits AI-proposed writes through owner-only Supabase RPCs.
 */
(function(root){
  'use strict';
  let client=null;

  function configure(supabaseClient){
    client=supabaseClient;
    return api;
  }

  function requireClient(){
    if(!client)throw new Error('OnSite Vision action layer is not configured.');
  }

  async function prepare({conversation_id='',action,user_message=''}={}){
    requireClient();
    const response=await client.rpc('vision_prepare_action_v1',{
      p_conversation_id:String(conversation_id||''),
      p_action:action||{},
      p_user_message:String(user_message||'')
    });
    if(response.error)throw response.error;
    return response.data;
  }

  async function execute(actionId){
    requireClient();
    const response=await client.rpc('vision_execute_action_v1',{p_action_id:String(actionId||'')});
    if(response.error)throw response.error;
    return response.data;
  }

  async function cancel(actionId){
    requireClient();
    const response=await client.rpc('vision_cancel_action_v1',{p_action_id:String(actionId||'')});
    if(response.error)throw response.error;
    return response.data;
  }

  const api=Object.freeze({
    version:'action-layer-v1',
    configure,
    prepare,
    execute,
    cancel
  });

  root.OnSiteVisionActions=api;
})(typeof window!=='undefined'?window:globalThis);
