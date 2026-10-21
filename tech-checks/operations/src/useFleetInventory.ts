import {useCallback,useEffect,useRef,useState} from 'react';
import {manualShopInventory} from '../../supabase/functions/cos-operations-pages/fleetShopProjection';
import {readMhelpInventoryAuthority} from './mhelpInventoryAuthority';
import {readRecordedRoster} from './fleetRecordedRoster';
type Api={fleetSource?:(source:'fieldMap',force?:boolean)=>Promise<any>;get(path:string):Promise<{data:any}>};
/** Same reviewed Product-ID receipt and manual Shop projection as Fleet. No name joins. */
export function fleetInventorySnapshot(map:any,now=Date.now()){
 const upload=manualShopInventory(map?.uploadInventory,map?.manualPlacementOverrides);
 const authority=readMhelpInventoryAuthority(upload,now);
 if(!authority)throw Error('Current reviewed equipment inventory is unavailable. Open Fleet or retry.');
 const roster=readRecordedRoster(map?.fleetRoster,map?.inventoryItems||map?.items).roster;
 return {authority,records:upload.records as Record<string,any>[],roster};
}
export function useFleetInventory(api:Api){
 const [value,setValue]=useState<ReturnType<typeof fleetInventorySnapshot>|null>(null),[error,setError]=useState(''),[loading,setLoading]=useState(true);
 const revision=useRef(0);
 const refresh=useCallback(async(force=false)=>{
  const request=++revision.current;setLoading(true);
  try{const map=api.fleetSource?await api.fleetSource('fieldMap',force):(await api.get('/api/field-map')).data;
   const next=fleetInventorySnapshot(map);if(request===revision.current){setValue(next);setError('');}
  }catch(e){if(request===revision.current)setError(e instanceof Error?e.message:'Inventory unavailable.');}
  finally{if(request===revision.current)setLoading(false);}
 },[api]);
 useEffect(()=>{void refresh();const update=()=>void refresh(),clear=()=>{revision.current++;setValue(null);setError('Your session changed. Reload COS.');setLoading(false);};
  window.addEventListener('cos-fleet-snapshot-updated',update);window.addEventListener('cos-private-data-invalidated',clear);
  return()=>{revision.current++;window.removeEventListener('cos-fleet-snapshot-updated',update);window.removeEventListener('cos-private-data-invalidated',clear);};
 },[refresh]);
 return {value,error,loading,refresh};
}
