import { useCallback,useEffect,useRef,useState } from 'react';
import { checkedTvSettings,checkedTvSections,DEFAULT_TV_SECTIONS,type TvSettings,type TvSection } from '../../supabase/functions/cos-operations-pages/tv-board-settings/index';
type Api={get:(path:string)=>Promise<{data:any}>;post:(path:string,body:any)=>Promise<{data:any}>};
export function useTvBoardSettings(api:Api){
  const [settings,setSettings]=useState<TvSettings>({sections:[...DEFAULT_TV_SECTIONS],revision:0,updatedAt:null});
  const [verified,setVerified]=useState(false),[error,setError]=useState(''),[saving,setSaving]=useState(false),[needsRefresh,setNeedsRefresh]=useState(false);
  const revision=useRef(0),alive=useRef(false),running=useRef(false);
  const refresh=useCallback(async()=>{
    const request=++revision.current;
    try{const next=checkedTvSettings((await api.get('/api/tv-board/settings')).data);if(alive.current&&request===revision.current){setSettings(next);setVerified(true);setError('');setNeedsRefresh(false);}return next;}
    catch(cause){if(alive.current&&request===revision.current)setError(cause instanceof Error?cause.message:'TV settings are unavailable.');return null;}
  },[api]);
  useEffect(()=>{
    alive.current=true;void refresh();const timer=window.setInterval(()=>{if(!running.current)void refresh();},60000);
    const invalid=()=>{revision.current++;setVerified(false);setSettings({sections:[],revision:0,updatedAt:null});setError('Sign in again to load TV settings.');};
    window.addEventListener('cos-private-data-invalidated',invalid);
    return()=>{alive.current=false;revision.current++;window.clearInterval(timer);window.removeEventListener('cos-private-data-invalidated',invalid);};
  },[refresh]);
  const save=async(sections:TvSection[],expectedRevision:number)=>{
    if(running.current||!verified||needsRefresh)return false;
    running.current=true;revision.current++;setSaving(true);
    try{
      const chosen=checkedTvSections(sections);
      await api.post('/api/tv-board/settings',{sections:chosen,expectedRevision});
      const fresh=await refresh();
      if(!fresh||fresh.revision!==expectedRevision+1||JSON.stringify(fresh.sections)!==JSON.stringify(chosen))throw new Error('The TV settings save could not be confirmed. Refresh before saving again.');
      window.dispatchEvent(new Event('cos-tv-settings-updated'));return true;
    }catch(cause){if(alive.current){setNeedsRefresh(true);setError(cause instanceof Error?cause.message:'The save could not be confirmed. Refresh before saving again.');}return false;}
    finally{running.current=false;if(alive.current)setSaving(false);}
  };
  return {settings,verified,error,saving,needsRefresh,refresh,save};
}
