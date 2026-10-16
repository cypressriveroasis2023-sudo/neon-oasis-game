// The existing morning form remains usable across an absent or staged backend.
import {mountTransferDesk} from './transfers/desk.js';
import {transferReadiness,transferReadinessMessage} from './transfers/readiness.js';
let mounted=null,dispose=null,identity='',cardFor=null,queued=false,generation=0;
const scope=()=>{
 const c=window.TechCheckContext,id=c?.getSession()?.user?.id,p=c?.getProfile?.();
 return c?.getRole()==='service'&&id&&p?.user_id===id&&p?.active===true&&!p?.archived_at&&
   !document.getElementById('appView')?.classList.contains('hidden')?{c,id}:null;
};
function clear(){generation++;dispose?.();dispose=null;mounted?.remove();mounted=null;identity='';cardFor=null;}
async function sync(){
 const value=scope(),card=document.getElementById('wlSvcTruckInventory');
 if(!value||value.id!==identity||card!==cardFor||mounted&&!mounted.isConnected)clear();
 if(!value||!card||mounted)return;
 identity=value.id;cardFor=card;const revision=++generation;
 const host=document.createElement('section');host.setAttribute('aria-label','Equipment handoff availability');
 const status=document.createElement('p');status.setAttribute('role','status');status.textContent='Checking equipment handoff availability…';
 host.append(status);card.append(host);mounted=host;
 const readiness=await transferReadiness(value.c,'service');
 if(revision!==generation||scope()?.id!==value.id||!host.isConnected||card!==document.getElementById('wlSvcTruckInventory'))return;
 const held=reason=>{
  if(revision!==generation||scope()?.id!==value.id||!host.isConnected)return;
  dispose?.();dispose=null;delete host.dataset.techcheckServiceTransfers;host.classList.remove('tc-transfer');
  host.setAttribute('aria-label','Equipment handoff availability');
  status.textContent=transferReadinessMessage(reason)+' Your morning form is unchanged. This availability check does not accept equipment.';
  const retry=document.createElement('button');retry.type='button';retry.textContent='Check handoff availability';
  retry.onclick=()=>{if(revision!==generation)return;clear();schedule();};host.replaceChildren(status,retry);
 };
 if(readiness.ready){host.removeAttribute('aria-label');host.dataset.techcheckServiceTransfers='';dispose=mountTransferDesk(host,value.c,{role:'service',onUnavailable:held});return;}
 held(readiness.reason);
}
function schedule(){if(queued)return;queued=true;queueMicrotask(()=>{queued=false;void sync();});}
new MutationObserver(schedule).observe(document.body,{childList:true,subtree:true,attributes:true,attributeFilter:['class']});
for(const event of ['techcheck:view-changed','techcheck:data-refreshed','pageshow','online'])window.addEventListener(event,schedule);
schedule();
