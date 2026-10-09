import {setFieldMapDisplay} from './field-map-display-host.js';
// Separate fleet-only frame; existing Owner shell and technician queues are untouched.
const context=()=>window.TechCheckContext;
const ids=new Set(['4f7044b5-86b6-411f-8898-39bb64b4ddbc','b7cc3cbf-d11e-4d4a-9742-c07701857911']);
let subject=null,allowed=false,pending=false,frame=null,dialog=null,button=null,trackerButton=null,opener=null,trackerAllowed=false,trackerChecked=false,trackerPending=false,epoch=0,authObserved=false,deepLinkOpened=false;
const active=()=>{const c=context(),p=c?.getProfile(),id=c?.getSession()?.user?.id;return c?.getRole()==='it'&&c?.getEffectiveRole()==='it'&&p?.active===true&&!p?.archived_at&&ids.has(id)&&!document.getElementById('appView')?.classList.contains('hidden')?id:null;};
function close(restoreFocus=true){setFieldMapDisplay(frame,false);frame?.remove();dialog?.remove();frame=null;dialog=null;if(restoreFocus&&(opener||button)?.isConnected)(opener||button).focus();opener=null;}
function reset(){epoch++;allowed=false;pending=false;deepLinkOpened=false;trackerAllowed=false;trackerChecked=false;trackerPending=false;close(false);button?.remove();trackerButton?.remove();button=null;trackerButton=null;}
async function verify(){const id=active();if(!id)return false;try{const r=await context().db.rpc('cos_verified_fleet_capabilities_v1');return active()===id&&!r.error&&r.data?.fleetRead===true;}catch{return false;}}
async function verifyTracker(){const id=active();if(!id)return false;const controller=new AbortController(),timer=setTimeout(()=>controller.abort(),10000);try{const session=(await context().db.auth.getSession()).data?.session;if(active()!==id||session?.user?.id!==id||!session?.access_token)return false;const response=await fetch('https://tughscoxralhofrckvxy.supabase.co/functions/v1/cos-operations-pages',{method:'POST',headers:{Authorization:'Bearer '+session.access_token,'Content-Type':'application/json'},body:JSON.stringify({method:'GET',path:'/api/session',body:null}),cache:'no-store',signal:controller.signal});if(!response.ok)return false;const data=await response.json();return active()===id&&data?.authorized===true&&data?.legacyOwner===false&&data?.role==='IT'&&data?.features?.unitTracker===true;}catch{return false;}finally{clearTimeout(timer);}}
function open(workspace='field-map',trigger=button){if(!allowed||active()!==subject||dialog||workspace==='unit-tracker'&&!trackerAllowed)return;opener=trigger;dialog=document.createElement('dialog');dialog.setAttribute('aria-label',workspace==='unit-tracker'?'IT Unit Tracker':'IT Camera Health and Field Map');dialog.style.cssText='padding:0;border:1px solid #777;background:#151515;color:white;width:98vw;max-width:none;height:96vh;max-height:none;';
 const back=document.createElement('button');back.type='button';back.textContent='← Return to IT Tech Checks';back.style.cssText='margin:8px;padding:10px 16px;';back.onclick=close;dialog.append(back);
 frame=document.createElement('iframe');frame.title=workspace==='unit-tracker'?'IT Unit Tracker':'IT Camera Health and Field Map';frame.style.cssText='display:block;width:100%;height:calc(100% - 60px);border:0;';frame.referrerPolicy='same-origin';frame.allow='geolocation; fullscreen';frame.allowFullscreen=true;frame.addEventListener('load',()=>setFieldMapDisplay(frame,false));
 const q=new URLSearchParams(location.search),unit=q.get('fieldUnit');frame.src='./operations/dist/index.html?mode=fleet#'+workspace+(workspace==='field-map'&&unit&&unit.length<=120&&!/[\u0000-\u001f]/.test(unit)?'?unitLabel='+encodeURIComponent(unit):'');dialog.append(frame);document.body.append(dialog);dialog.addEventListener('cancel',e=>{e.preventDefault();close();});dialog.showModal();back.focus();}
async function present(){const c=context();if(c?.db?.auth&&!authObserved){authObserved=true;c.db.auth.onAuthStateChange(()=>{subject=null;reset();queueMicrotask(present);});}
 const id=active();if(id!==subject){subject=id;reset();}if(!id||pending)return;
 if(!allowed){pending=true;const revision=epoch;const ok=await verify();if(revision!==epoch)return;pending=false;if(!ok)return;allowed=true;}
 // The legacy Home redraw hides its siblings and replaces its children. Keep the
 // entry inside the actual Home workspace and move the same button after redraws.
 // The legacy stylesheet hides its header at every size, so mount just below it.
 const head=document.querySelector('#wlItHome .wl-it-command-head');
 if(!head){button?.remove();trackerButton?.remove();return;}
 const target=head.parentElement;
 if(!button){button=document.createElement('button');button.type='button';button.className='btn mini wl-red';button.dataset.cosFieldView='';button.textContent='Field View';button.style.cssText='min-height:52px;width:100%;padding:12px 18px;margin:0 0 14px;text-align:left;font-size:17px;';button.onclick=()=>open();}
 if(button.parentElement!==target)head.after(button);
 if(!trackerChecked&&!trackerPending){trackerPending=true;const revision=epoch;void verifyTracker().then(ok=>{if(revision!==epoch)return;trackerPending=false;trackerChecked=true;trackerAllowed=ok;void present();});}
 if(trackerAllowed){if(!trackerButton){trackerButton=document.createElement('button');trackerButton.type='button';trackerButton.className='btn mini wl-red';trackerButton.dataset.cosUnitTracker='';trackerButton.textContent='Unit Tracker';trackerButton.style.cssText=button.style.cssText;trackerButton.onclick=()=>open('unit-tracker',trackerButton);}if(trackerButton.parentElement!==target)button.after(trackerButton);}
 if(!deepLinkOpened){deepLinkOpened=true;const q=new URLSearchParams(location.search);if(q.get('fieldView')==='1'||q.has('fieldUnit'))open();}
}
window.addEventListener('message',async event=>{if(event.origin!==location.origin||event.source!==frame?.contentWindow||!allowed||active()!==subject)return;const d=event.data;if(!d||typeof d!=='object')return;
 if(d.type==='COS_FIELD_MAP_DISPLAY_MODE'&&typeof d.active==='boolean'){setFieldMapDisplay(frame,d.active);return;}
 if(d.type==='COS_OPERATIONS_TOKEN_REQUEST'&&typeof d.requestId==='string'&&d.requestId.length<=100){const requested=subject,target=frame.contentWindow;let token=null;try{const s=await context().db.auth.getSession();if(await verify()&&active()===requested&&s.data?.session?.user?.id===requested&&target===frame?.contentWindow)token=s.data.session.access_token;}catch{}
  if(target===frame?.contentWindow)target.postMessage({type:'COS_OPERATIONS_TOKEN_RESPONSE',requestId:d.requestId,accessToken:token,role:token?'it':null},location.origin);if(!token){allowed=false;close();}return;}
 if(d.type==='COS_OPERATIONS_NAVIGATE'){if(d.route==='camera-health')location.assign('./camera-health.html');else if(['it','production-return','operations'].includes(d.route))close();else if(d.route==='logout'){close();window.logout?.();}}
});
let scheduled=false;new MutationObserver(()=>{if(scheduled)return;scheduled=true;queueMicrotask(()=>{scheduled=false;void present();});}).observe(document.body,{subtree:true,childList:true,attributes:true,attributeFilter:['class']});
void present();
