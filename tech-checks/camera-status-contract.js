/* New follow-up implementation, not the unrecovered c3517ee5 helper.
 * Pure presentation only. Callers retain identity, revision and timestamp authority.
 * Reachable service never proves camera coverage, video, activation or placement.
 */
(function(root){
  'use strict';
  function serviceState(evidence,fresh){
    if(!evidence||fresh!==true)return 'verifying';
    if(evidence.status==='online'&&evidence.reachable===true)return 'online';
    if(evidence.status==='offline'&&evidence.reachable!==true&&(evidence.confirmedOutage===true||Number.isInteger(evidence.consecutiveFailures)&&evidence.consecutiveFailures>=3))return 'offline';
    return evidence.status==='degraded'&&evidence.reachable===true?'degraded':'verifying';
  }
  function presentation({providerState='verifying',cameraState='verifying',serviceState='verifying',resource='unknown',activation='',placement='unknown',readFailed=false}){
    // Provider state is supplied only after the caller's resource/source guards.
    const provider=readFailed?'verifying':providerState,service=readFailed?'verifying':serviceState;
    const basis=provider!=='verifying'?'provider':'connection',state=basis==='provider'?provider:service;
    const prefix=basis==='connection'?'IP / PORT':({camera:'CAMERA RECORD',detector:'DETECTOR RECORD',recorder:'RECORDER'})[resource]||'PROVIDER RESOURCE';
    const label=prefix+' '+({online:'ONLINE',offline:'OFFLINE',degraded:'MIXED / UNVERIFIED',verifying:'UNVERIFIED'}[state]||'UNVERIFIED');
    const review=['shop','inactive'].includes(placement)&&service==='online'?'PLACEMENT REVIEW: '+(placement==='shop'?'SHOP / ROOT':'INACTIVE')+' + service reachable. Confirm physical placement; a response does not move equipment.':'';
    return {state,label,basis,providerState:provider,cameraState:readFailed?'verifying':cameraState,serviceState:service,activation,placement,review,readFailed,video:'Video not verified'};
  }
  root.CameraStatusContract={serviceState,presentation};
})(globalThis);
