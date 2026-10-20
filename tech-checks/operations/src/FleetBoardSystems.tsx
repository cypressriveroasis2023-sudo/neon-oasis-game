import {useEffect,useState} from 'react';
import type {FleetCommandCenterData} from './fleetCommandCenterModel';
import FleetCardIcon from './FleetCardIcon';

type Props={data:FleetCommandCenterData|null;onSystem:(system:string)=>void};
/** Presentation of the existing Product-ID classifier; no independent polling or inferred totals. */
export default function FleetBoardSystems(p:Props){
 const [expanded,setExpanded]=useState(()=>window.matchMedia('(min-width: 751px)').matches);
 useEffect(()=>{const media=window.matchMedia('(min-width: 751px)'),change=()=>setExpanded(media.matches);media.addEventListener('change',change);return()=>media.removeEventListener('change',change);},[]);
 const data=p.data;
 const definitions=[['avigilon','Avigilon','camera'],['star4live','Star4Live','camera'],['reconeyez','Recon / Recon II','router'],['victron','Victron / Helios','battery']] as const;
 return <details className='cos-board-systems' open={expanded} onToggle={event=>setExpanded(event.currentTarget.open)}>
  <summary>Systems <span>Avigilon · Star4Live · Recon · Victron</span></summary>
  <div className='cos-board-provider-grid' aria-label='Saved system status'>
   {definitions.map(([key,title,icon])=>{const panel=data?.panels.find(panel=>panel.key===key);return <button type='button' key={key} aria-label={'View '+title+' details'} onClick={()=>p.onSystem(key)}>
    <div className='cos-board-provider-title'><FleetCardIcon kind={icon}/><strong>{title}</strong><span aria-hidden='true'>›</span></div>
    <div className='cos-board-provider-values'>{(['online','offline','unverified'] as const).map(status=><span key={status} className={'cos-board-provider-'+status}><b>{panel?.counts?.[status]??'—'}</b>{status==='unverified'?'Unverified':status==='online'?'Online':'Offline'}</span>)}</div>
    <small>{key==='victron'?'Power telemetry · overlaps camera systems':panel?'Saved observations · Field equipment':'Waiting for validated source data'}</small>
   </button>;})}
  </div>
  {data&&<p className='cos-board-system-note'>{data.counts.online+data.counts.offline+data.counts.unverified} camera-capable + {data.counts.support} support equipment = {data.field} Field products. Victron reports power separately.</p>}
 </details>;
}
