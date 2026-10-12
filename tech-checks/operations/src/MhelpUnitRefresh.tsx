import {useEffect,useRef,useState} from 'react';
import {api} from './api';
import {mhelpUnitIdentity} from '../shared/mhelpUnitIdentity';
type Props={unit:{id:string;unitNumber:string;mhelpLocation?:Record<string,any>;mhelpLocationReviewReason?:string|null};onUpdated:()=>void};
export default function MhelpUnitRefresh({unit,onUpdated}:Props){
 const [busy,setBusy]=useState(false),[error,setError]=useState(''),[preview,setPreview]=useState<Record<string,any>|null>(null);const revision=useRef(0),pending=useRef<AbortController|null>(null);
 useEffect(()=>{const clear=()=>{revision.current++;pending.current?.abort();setPreview(null);setBusy(false);};window.addEventListener('cos-private-data-invalidated',clear);clear();return()=>{clear();window.removeEventListener('cos-private-data-invalidated',clear);};},[unit.id]);
 if(!mhelpUnitIdentity(unit.unitNumber)||!/^([a-f0-9]{8}-){1}[a-f0-9]{4}-[a-f0-9]{4}-[a-f0-9]{4}-[a-f0-9]{12}$/i.test(unit.id))return null;
 const refresh=async()=>{if(busy)return;const current=++revision.current,controller=new AbortController();pending.current=controller;setBusy(true);setError('');setPreview(null);
  try{const v=(await api.post('/api/mhelpdesk/partner/unit-location',{unitId:unit.id,unitName:unit.unitNumber},{signal:controller.signal})).data;if(current!==revision.current)return;
   if(v.contract!=='COS_MHELP_UNIT_LOCATION_V1'||v.unitName!==unit.unitNumber||v.locationEvidenceUpdated!==true)throw Error('The location update could not be verified. Reload this unit.');setPreview(v);onUpdated();
  }catch(e){if(current===revision.current)setError(e instanceof Error?e.message:'Current mHelpDesk location is unavailable.');}finally{if(current===revision.current){pending.current=null;setBusy(false);}}
 };
 const location=preview||unit.mhelpLocation;
 return <section className='mhelp-unit-location' aria-label='Current mHelpDesk unit location'><h3>mHelpDesk service location</h3><button type='button' className='secondary' disabled={busy} onClick={()=>void refresh()}>{busy?'Reading current assignment…':'Refresh mHelpDesk location'}</button>{error&&<p role='alert'>{error}</p>}{unit.mhelpLocationReviewReason&&<p role='note'>{unit.mhelpLocationReviewReason}</p>}{location&&<><p><b>{location.placement==='SHOP'?'Shop / ROOT':'Field'}</b> · {[location.customer,location.site].filter(Boolean).join(' · ')}</p><p>{location.address||'Service address not available'}</p><small>Read {new Date(location.readAt||location.observedAt).toLocaleString()}{location.point?' · '+location.coordinateSource+' (unverified)':''}</small></>}<p>Reads the current equipment assignment and service address for this unit. Verified GPS and saved installation history are preserved.</p></section>;
}
