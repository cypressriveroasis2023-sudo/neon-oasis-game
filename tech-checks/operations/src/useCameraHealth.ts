import {retainCompletedSnapshot} from './snapshotRetention';
import {automaticRefreshDue,CAMERA_AUTO_REFRESH_MS} from './refreshCadence';
import { useCallback,useEffect,useRef,useState } from 'react';
import {type FleetSnapshot} from './fleetSnapshot';
import { api } from './api';
import { validateCameraHealth,type Health } from './fieldCameraHealth';
import {rememberCameraHistory,type CameraHistory} from './cameraLastKnown';
export function useCameraHealth(forceOnEntry=false){
  const [fleet,setFleet]=useState<FleetSnapshot|null>(null),[error,setError]=useState(''),[loading,setLoading]=useState(false),[now,setNow]=useState(Date.now());
  const [cameraHistory,setCameraHistory]=useState<CameraHistory>(new Map());
  const revision=useRef(0),running=useRef(false),lastAttemptAt=useRef(0),historyRevision=useRef(0);
  const [refreshMap,setRefreshMap]=useState<FleetSnapshot['fieldMap']|null>(null);
  const completed=useRef<FleetSnapshot|null>(null);
  // Independently loaded map authority can arrive after the health response.
  // Evaluate accepted data at local arrival time without starting another read.
  const updateClock=useCallback(()=>setNow(completed.current?Date.parse(completed.current.readAt):Date.now()),[]);
  const refresh=useCallback(async(force=false)=>{
    if(running.current)return;
    running.current=true;lastAttemptAt.current=Date.now(); const request=++revision.current,historyRequest=historyRevision.current;setLoading(true);
    try {const next=await api.fleet(force,saved=>{if(request===revision.current){if(!retainCompletedSnapshot(completed.current,saved)){completed.current=saved;setFleet(saved);setNow(Date.parse(saved.readAt));}}});validateCameraHealth(next.health);if(request===revision.current){
      // Adopting a cached pair is not a new saved-data read. Keep the original
      // request deadline when a view mounts or another consumer publishes it.
      if(typeof next.readStartedAt==='number'&&Number.isFinite(next.readStartedAt)&&next.readStartedAt<=Date.now())lastAttemptAt.current=next.readStartedAt;
      setRefreshMap(next.fieldMap);
      if(retainCompletedSnapshot(completed.current,next)){
        if((next.fieldMap as any).productConnectionsState!=='pending')setError('Connection refresh failed. Last completed results remain displayed with their original check times.');
        return;
      }
      completed.current=next;
      const acceptedAt=Date.now();if(historyRequest===historyRevision.current)setCameraHistory(previous=>historyRequest===historyRevision.current?rememberCameraHistory(previous,next,acceptedAt):previous);
      setFleet(next);setError('');setNow(Date.parse(next.readAt));}}
    catch(cause){if(request===revision.current){setError(cause instanceof Error?cause.message:'Camera Health could not be loaded.');}}
    finally{if(request===revision.current){running.current=false;setLoading(false);}}
  },[updateClock]);
  useEffect(()=>{void refresh(forceOnEntry);const timer=window.setInterval(()=>{if(automaticRefreshDue(lastAttemptAt.current,Date.now(),document.hidden,CAMERA_AUTO_REFRESH_MS))void refresh();},60000);return()=>{revision.current++;running.current=false;window.clearInterval(timer);};},[refresh,forceOnEntry]);
  // Ordinary host navigation hides historical evidence without changing the
  // baseline fleet/session state. Pre-hide reads cannot restore that history.
  useEffect(()=>{const clear=()=>{revision.current++;historyRevision.current++;running.current=false;completed.current=null;setRefreshMap(null);setFleet(null);setCameraHistory(new Map());setLoading(false);setError('Your fleet session changed. Reload to verify the current account.');};const hidden=(event:MessageEvent)=>{if(event.origin===location.origin&&event.source===window.parent&&event.data?.type==='COS_OPERATIONS_HIDE_PRIVATE_EVIDENCE'){historyRevision.current++;setCameraHistory(new Map());}};const changed=()=>{void refresh();};const failed=()=>setError('The shared camera and placement refresh failed. Reload saved results to verify current status.');window.addEventListener('cos-private-data-invalidated',clear);window.addEventListener('message',hidden);window.addEventListener('cos-fleet-snapshot-updated',changed);window.addEventListener('cos-fleet-snapshot-failed',failed);return()=>{window.removeEventListener('cos-private-data-invalidated',clear);window.removeEventListener('message',hidden);window.removeEventListener('cos-fleet-snapshot-updated',changed);window.removeEventListener('cos-fleet-snapshot-failed',failed);};},[refresh]);
  return {data:fleet?.health||null,fleet,refreshMap,error,loading,now,refresh,updateClock,cameraHistory};
}
