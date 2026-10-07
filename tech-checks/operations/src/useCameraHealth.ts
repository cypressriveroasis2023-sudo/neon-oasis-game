import {automaticRefreshDue} from './refreshCadence';
import { useCallback,useEffect,useRef,useState } from 'react';
import { api } from './api';
import { validateCameraHealth,type Health } from './fieldCameraHealth';
export function useCameraHealth(){
  const [data,setData]=useState<Health|null>(null),[error,setError]=useState(''),[loading,setLoading]=useState(false),[now,setNow]=useState(Date.now());
  const revision=useRef(0),running=useRef(false),lastAttemptAt=useRef(0);
  const refresh=useCallback(async()=>{
    if(running.current)return;
    running.current=true;lastAttemptAt.current=Date.now(); const request=++revision.current;setLoading(true);
    try {const next=validateCameraHealth((await api.get('/api/camera-health/summary-v3')).data);if(request===revision.current){setData(next);setError('');setNow(Date.now());}}
    catch(cause){if(request===revision.current){setData(null);setError(cause instanceof Error?cause.message:'Camera Health could not be loaded.');}}
    finally{if(request===revision.current){running.current=false;setLoading(false);}}
  },[]);
  useEffect(()=>{void refresh();const timer=window.setInterval(()=>{setNow(Date.now());if(automaticRefreshDue(lastAttemptAt.current,Date.now(),document.hidden))void refresh();},60000);const visible=()=>{setNow(Date.now());if(automaticRefreshDue(lastAttemptAt.current,Date.now(),document.hidden))void refresh();};document.addEventListener('visibilitychange',visible);return()=>{revision.current++;running.current=false;window.clearInterval(timer);document.removeEventListener('visibilitychange',visible);};},[refresh]);
  return {data,error,loading,now,refresh};
}
