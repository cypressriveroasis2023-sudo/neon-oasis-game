import {useEffect,useState} from 'react';
import './tvBoardExtensions.css';
import {TV_SECTIONS,type TvSection} from '../../supabase/functions/cos-operations-pages/tv-board-settings/index';
import type {useTvBoardSettings} from './useTvBoardSettings';
export default function TvBoardControls({control}:{control:ReturnType<typeof useTvBoardSettings>}){
  const {settings,verified,error,saving,needsRefresh}=control;
  const [draft,setDraft]=useState<TvSection[]>(settings.sections),[base,setBase]=useState(settings.revision),[dirty,setDirty]=useState(false),[notice,setNotice]=useState('');
  const [seconds,setSeconds]=useState(String(settings.rotationSeconds));
  const secondsValid=Number.isSafeInteger(Number(seconds))&&Number(seconds)>=5&&Number(seconds)<=300;
  useEffect(()=>{if(!dirty){setDraft(settings.sections);setBase(settings.revision);setSeconds(String(settings.rotationSeconds));}},[settings,dirty]);
  return <section className='daily-board-tv-settings' aria-label='TV board settings'>
    <div><h3>Choose what the TV shows</h3><p>Add or remove sections. Saved selections apply to your TV within a minute.</p></div>
    <div className='tv-section-choices'>{TV_SECTIONS.map(section=><label key={section.key}><input type='checkbox' checked={draft.includes(section.key)} disabled={saving||!verified} onChange={event=>{setDirty(true);setNotice('');setDraft(current=>event.target.checked?[...current,section.key]:current.filter(key=>key!==section.key));}}/>{section.label}</label>)}</div>
    <label className='tv-rotation-control'>Rotation time (seconds)<input type='number' min='5' max='300' step='1' value={seconds} disabled={saving||!verified} aria-describedby='tv-rotation-note' onChange={event=>{setSeconds(event.target.value);setDirty(true);setNotice('');}}/></label>
    <p id='tv-rotation-note'>Seconds per page or map area. Choose 5–300 seconds. Map close-ups visit areas with outages first; Camera Health shows red units only.</p>
    <p className='daily-board-note'>Pending sections show all unfinished jobs, including future and unscheduled work. Teddy and Victor have no company-vehicle inspection requirements.</p>
    <div className='daily-board-actions'><button disabled={!dirty||saving||!verified||needsRefresh||!secondsValid} onClick={()=>void control.save(draft,base,Number(seconds)).then(ok=>{if(ok){setDirty(false);setNotice('TV settings saved and verified.');}})}>{saving?'Saving…':'Save TV settings'}</button><button className='secondary' disabled={saving} onClick={()=>void control.refresh().then(next=>{if(next){setDirty(false);setDraft(next.sections);setBase(next.revision);setSeconds(String(next.rotationSeconds));setNotice('TV settings refreshed.');}})}>Refresh TV settings</button></div>
    {(error||notice)&&<p role='status'>{error||notice}</p>}{!verified&&!error&&<p role='status'>Loading shared TV settings…</p>}
  </section>;
}
