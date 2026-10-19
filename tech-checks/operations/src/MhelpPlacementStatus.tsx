import {cameraTime} from './fieldCameraHealth';

/** Read-only presentation of the existing saved placement-sync receipt. */
export default function MhelpPlacementStatus({value,now}:{value:unknown;now:number}){
 const sync=value&&typeof value==='object'&&!Array.isArray(value)?value as Record<string,unknown>:null;
 const verified=sync?.contract==='COS_MHELP_PLACEMENT_V1';
 const retry=verified&&typeof sync?.nextReadAt==='string'?Date.parse(sync.nextReadAt):NaN;
 const delayed=verified&&sync?.errorCode==='source_rate_limited';
 const successAt=sync?.inventoryEnabled===true?sync.lastInventorySuccessAt:sync?.lastSuccessAt;
 return <section className='cos-fleet-placement-status' aria-label='mHelpDesk placement update'>
  <b>{delayed?'MHelp update delayed':verified&&sync?.errorCode?'MHelp update unavailable':verified&&sync?.inventoryEnabled===true?'mHelpDesk automatic inventory updates':verified?'MHelp saved placement evidence':'MHelp update status unavailable'}</b>
  {delayed&&<p>Vendor rate limit. Camera, router and battery observations are separate.</p>}
  <small>{sync?.inventoryEnabled===true?'Last successful inventory update':'Last successful placement read'}: {cameraTime(verified&&typeof successAt==='string'?successAt:null,now)}</small>
  {Number.isFinite(retry)&&<small>Retry eligible no earlier than {new Intl.DateTimeFormat(undefined,{year:'numeric',month:'short',day:'numeric',hour:'numeric',minute:'2-digit',second:'2-digit',timeZoneName:'short'}).format(new Date(retry))}. A later read must confirm recovery.</small>}
 </section>;
}
