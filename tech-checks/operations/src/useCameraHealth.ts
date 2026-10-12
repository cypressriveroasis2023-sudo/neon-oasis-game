import {automaticRefreshDue} from './refreshCadence';
import { useCallback,useEffect,useRef,useState } from 'react';
import {type FleetSnapshot} from './fleetSnapshot';
import { api } from './api';
import { validateCameraHealth,type Health } from './fieldCameraHealth';
export function useCameraHealth(){
  const [fleet,setFleet]=useState<FleetSnapshot|null>(null),[error,setError]=useState(''),[loading,setLoading]=useState(false),[now,setNow]=useState(Date.now());
  const revision=useRef(0),running=useRef(false),lastAttemptAt=useRef(0);
  // Independently loaded map authority can arrive after the health response.
  // Evaluate accepted data at local arrival time without starting another read.
  const updateClock=useCallback(()=>setNow(Date.now()),[]);
  const refresh=useCallback(async(force=false)=>{
    if(running.current)return;
    running.current=true;lastAttemptAt.current=Date.now(); const request=++revision.current;setLoading(true);
    try {const next=await api.fleet(force);validateCameraHealth(next.health);if(request===revision.current){setFleet(next);setError('');updateClock();}}
    catch(cause){if(request===revision.current){setFleet(null);setError(cause instanceof Error?cause.message:'Camera Health could not be loaded.');}}
    finally{if(request===revision.current){running.current=false;setLoading(false);}}
  },[updateClock]);
  useEffect(()=>{void refresh();const timer=window.setInterval(()=>{setNow(Date.now());if(automaticRefreshDue(lastAttemptAt.current,Date.now(),document.hidden))void refresh();},60000);const visible=()=>{setNow(Date.now());if(automaticRefreshDue(lastAttemptAt.current,Date.now(),document.hidden))void refresh();};document.addEventListener('visibilitychange',visible);return()=>{revision.current++;running.current=false;window.clearInterval(timer);document.removeEventListener('visibilitychange',visible);};},[refresh]);
  useEffect(()=>{const clear=()=>{revision.current++;running.current=false;setFleet(null);setLoading(false);setError('Your fleet session changed. Reload to verify the current account.');};const changed=()=>{void refresh();};window.addEventListener('cos-private-data-invalidated',clear);window.addEventListener('cos-fleet-snapshot-updated',changed);return()=>{window.removeEventListener('cos-private-data-invalidated',clear);window.removeEventListener('cos-fleet-snapshot-updated',changed);};},[refresh]);
  return {data:fleet?.health||null,fleet,error,loading,now,refresh,updateClock};
}
