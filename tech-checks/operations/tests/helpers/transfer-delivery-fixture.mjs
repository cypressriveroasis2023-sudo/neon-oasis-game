export const transferIds={it:'00000000-0000-4000-8000-000000000001',service:'00000000-0000-4000-8000-000000000002',checkout:'10000000-0000-4000-8000-000000000001',receipt:'10000000-0000-4000-8000-000000000002',return:'10000000-0000-4000-8000-000000000003'};
export const signatureJpeg=new Uint8Array([255,216,255,192,0,17,8,0,180,2,88,3,1,17,0,2,17,0,3,17,0,255,217]);
export function deliveryFixture({kind='receipt',count=1,drawn=false}={}) {
 const ids=transferIds, names={it:'Synthetic <IT> & technician',service:'Synthetic Service technician'};
 const items=Array.from({length:count},(_,i)=>({equipment_key:'sniper:'+String(i+1).padStart(3,'0'),family:'Sniper',unit_tag:String(i+1).padStart(3,'0'),sims:['0012345678901234567'+i],battery_count:2,parts:[{name:'SD card',quantity:1}]}));
 const kinds=kind==='checkout'?['checkout']:kind==='cancel'?['checkout','cancel']:kind==='receipt'?['checkout','receipt']:['checkout','receipt','return'];
 const events=kinds.map((eventKind,index)=>{
  const id=ids[eventKind]||'10000000-0000-4000-8000-000000000004', actor=eventKind==='receipt'?ids.service:ids.it, name=eventKind==='receipt'?names.service:names.it, signedAt='2026-10-17T12:0'+index+':00Z';
  const actual=eventKind==='cancel'?[]:structuredClone(items), photos=actual.map((item,i)=>({equipment_key:item.equipment_key,kind:'unit',path:actor+'/'+id+'/'+(i+1).toString(16).padStart(64,'0')+'.jpg'}));
  const signature={method:drawn?'drawn':'typed',name,signed_by:actor,signed_at:signedAt,statement:'I physically checked this exact equipment.'};
  if(drawn){signature.path=actor+'/'+id+'/'+'f'.repeat(64)+'.jpg';photos.push({kind:'signature',path:signature.path});}
  return {id,kind:eventKind,actor_id:actor,actor_name:name,signed_at:signedAt,photos,snapshot:{transfer_id:ids.checkout,revision:index+1,state:{checkout:'awaiting_service',receipt:'accepted',return:'returned_review',cancel:'cancelled'}[eventKind],expected:structuredClone(items),actual,checks:Object.fromEntries(actual.map(i=>[i.equipment_key,{physical_condition_ok:true}])),differences:[],notes:'Synthetic signed evidence.',signature}};
 });
 return {version:1,event_id:events.at(-1).id,transfer_id:ids.checkout,revision:events.length,kind,it_actor:ids.it,service_actor:ids.service,it_name:names.it,service_name:names.service,events};
}
