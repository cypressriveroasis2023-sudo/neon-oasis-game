// Separate fleet-only frame; existing Owner shell and technician queues are untouched.
const context=()=>window.TechCheckContext;
const ids=new Set(['4f7044b5-86b6-411f-8898-39bb64b4ddbc','b7cc3cbf-d11e-4d4a-9742-c07701857911']);
let subject=null,allowed=false,pending=false,frame=null,dialog=null,button=null,epoch=0,authObserved=false;
const active=()=>{const c=context(),p=c?.getProfile(),id=c?.getSession()?.user?.id;return c?.getRole()==='it'&&c?.getEffectiveRole()==='it'&&p?.active===true&&!p?.archived_at&&ids.has(id)&&!document.getElementById('appView')?.classList.contains('hidden')?id:null;};
function close(){frame?.remove();dialog?.remove();frame=null;dialog=null;button?.focus();}
function reset(){epoch++;allowed=false;pending=false;close();button?.remove();button=null;}
async function verify(){const id=active();if(!id)return false;try{const r=await context().db.rpc('cos_verified_fleet_capabilities_v1');return active()===id&&!r.error&&r.data?.fleetRead===true;}catch{return false;}}
function open(){if(!allowed||active()!==subject)return;close();dialog=document.createElement('dialog');dialog.setAttribute('aria-label','IT Camera Health and Field Map');dialog.style.cssText='padding:0;border:1px solid #777;background:#151515;color:white;width:98vw;max-width:none;height:96vh;max-height:none;';
 const back=document.createElement('button');back.type='button';back.textContent='← Return to IT Tech Checks';back.style.cssText='margin:8px;padding:10px 16px;';back.onclick=close;dialog.append(back);
 frame=document.createElement('iframe');frame.title='IT Camera Health and Field Map';frame.style.cssText='display:block;width:100%;height:calc(100% - 60px);border:0;';frame.referrerPolicy='same-origin';frame.allow='geolocation';
 const q=new URLSearchParams(location.search),unit=q.get('fieldUnit');frame.src='./operations/dist/index.html?mode=fleet#field-map'+(unit&&unit.length<=120&&!/[\u0000-\u001f]/.test(unit)?'?unitLabel='+encodeURIComponent(unit):'');dialog.append(frame);document.body.append(dialog);dialog.addEventListener('cancel',e=>{e.preventDefault();close();});dialog.showModal();back.focus();}
async function present(){const c=context();if(c?.db?.auth&&!authObserved){authObserved=true;c.db.auth.onAuthStateChange(()=>{subject=null;reset();queueMicrotask(present);});}
 const id=active();if(id!==subject){subject=id;reset();}if(!id||pending)return;
 if(!allowed){pending=true;const revision=epoch;const ok=await verify();if(revision!==epoch)return;pending=false;if(!ok)return;allowed=true;}
 if(button&&!button.isConnected)button=null;
 if(!button){const target=document.getElementById('view-it');if(!target)return;button=document.createElement('button');button.type='button';button.className='btn';button.textContent='Field Map & Camera Health';button.onclick=open;target.prepend(button);
  const q=new URLSearchParams(location.search);if(q.get('fieldView')==='1'||q.has('fieldUnit'))open();}
}
window.addEventListener('message',async event=>{if(event.origin!==location.origin||event.source!==frame?.contentWindow||!allowed||active()!==subject)return;const d=event.data;if(!d||typeof d!=='object')return;
 if(d.type==='COS_OPERATIONS_TOKEN_REQUEST'&&typeof d.requestId==='string'&&d.requestId.length<=100){const requested=subject,target=frame.contentWindow;let token=null;try{const s=await context().db.auth.getSession();if(await verify()&&active()===requested&&s.data?.session?.user?.id===requested&&target===frame?.contentWindow)token=s.data.session.access_token;}catch{}
  if(target===frame?.contentWindow)target.postMessage({type:'COS_OPERATIONS_TOKEN_RESPONSE',requestId:d.requestId,accessToken:token,role:token?'it':null},location.origin);if(!token){allowed=false;close();}return;}
 if(d.type==='COS_OPERATIONS_NAVIGATE'){if(d.route==='camera-health')location.assign('./camera-health.html');else if(['it','production-return','operations'].includes(d.route))close();else if(d.route==='logout'){close();window.logout?.();}}
});
let scheduled=false;new MutationObserver(()=>{if(scheduled)return;scheduled=true;queueMicrotask(()=>{scheduled=false;void present();});}).observe(document.body,{subtree:true,childList:true,attributes:true,attributeFilter:['class']});
void present();
