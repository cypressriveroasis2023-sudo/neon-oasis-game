// Adds recipient-scoped verification without replacing Service's working daily form.
import {mountTransferDesk} from './transfers/desk.js';
let mounted=null,dispose=null,identity='',queued=false;
function sync(){
 const c=window.TechCheckContext,actor=c?.getSession()?.user?.id;
 const card=document.getElementById('wlSvcTruckInventory');
 const allowed=c?.getRole()==='service'&&actor&&!document.getElementById('appView')?.classList.contains('hidden');
 if(!allowed||actor!==identity||mounted&&!mounted.isConnected){dispose?.();dispose=null;mounted?.remove();mounted=null;identity=allowed?actor:'';}
 if(!allowed||!card||mounted)return;
 mounted=document.createElement('section');mounted.dataset.techcheckServiceTransfers='';card.append(mounted);identity=actor;
 dispose=mountTransferDesk(mounted,c,{role:'service'});
}
function schedule(){if(queued)return;queued=true;queueMicrotask(()=>{queued=false;sync();});}
new MutationObserver(schedule).observe(document.body,{childList:true,subtree:true,attributes:true,attributeFilter:['class']});
for(const event of ['techcheck:view-changed','techcheck:data-refreshed','pageshow'])window.addEventListener(event,schedule);
schedule();
