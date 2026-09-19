/* Cameras On Site — OnSite Vision Persistence Layer
 * Version: persistence-v1
 * Owner-private conversation persistence through audited Supabase RPCs.
 */
(function(root){
  'use strict';
  let client=null;

  function configure(supabaseClient){
    client=supabaseClient;
    return api;
  }
  function requireClient(){
    if(!client)throw new Error('OnSite Vision persistence is not configured.');
  }
  function ensureMessageIds(chat){
    const rows=Array.isArray(chat?.messages)?chat.messages:[];
    rows.forEach((m,index)=>{
      if(!m.id){
        const random=(globalThis.crypto?.randomUUID?.()||Math.random().toString(36).slice(2));
        m.id=String(chat.id||'chat')+'-'+index+'-'+random;
      }
    });
    return rows;
  }
  async function load(limit=20){
    requireClient();
    const response=await client.rpc('vision_load_conversations_v1',{p_limit:Number(limit||20)});
    if(response.error)throw response.error;
    return Array.isArray(response.data)?response.data:[];
  }
  async function save(chat){
    requireClient();
    if(!chat?.id)return null;
    ensureMessageIds(chat);
    const response=await client.rpc('vision_save_conversation_v1',{
      p_conversation_id:String(chat.id),
      p_title:String(chat.title||'New conversation'),
      p_active_ticket:String(chat.ticket||''),
      p_draft:chat.draft||null,
      p_messages:(chat.messages||[]).map(m=>({
        id:String(m.id||''),
        role:String(m.role||''),
        text:String(m.text||''),
        html:String(m.html||''),
        at:String(m.at||new Date().toISOString())
      }))
    });
    if(response.error)throw response.error;
    return response.data;
  }
  async function saveAll(chats,limit=20){
    const rows=(Array.isArray(chats)?chats:[]).slice(0,Math.max(1,Number(limit||20)));
    for(const chat of rows)await save(chat);
    return rows.length;
  }
  async function archive(conversationId){
    requireClient();
    const response=await client.rpc('vision_archive_conversation_v1',{p_conversation_id:String(conversationId||'')});
    if(response.error)throw response.error;
    return true;
  }

  const api=Object.freeze({
    version:'persistence-v1',
    configure,
    ensureMessageIds,
    load,
    save,
    saveAll,
    archive
  });
  root.OnSiteVisionPersistence=api;
})(typeof window!=='undefined'?window:globalThis);
