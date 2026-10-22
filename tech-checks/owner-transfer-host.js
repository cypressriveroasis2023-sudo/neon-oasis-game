// Add the existing equipment desk to the Owner route without altering legacy checks.
import {mountTransferDesk} from './transfers/desk.js';
let mounted=null,dispose=null,identity='',pageFor=null,queued=false;
const scope=()=>{
 const c=window.TechCheckContext,id=c?.getSession()?.user?.id,p=c?.getProfile?.();
 const view=document.getElementById('view-owner'),page=document.getElementById('ownerRouteView');
 return c?.getRole()==='owner'&&c.getEffectiveRole()==='owner'&&id&&p?.user_id===id&&p?.role==='owner'&&p.active===true&&!p.archived_at&&
  view?.dataset.ownerRoute==='handoffs'&&!view.classList.contains('hidden')&&!document.getElementById('appView')?.classList.contains('hidden')&&page?{c,id,page}:null;
};
function clear(){dispose?.();dispose=null;mounted?.remove();mounted=null;identity='';pageFor=null;}
function sync(){
 const value=scope();
 if(!value||value.id!==identity||value.page!==pageFor||mounted&&!mounted.isConnected)clear();
 if(!value||mounted)return;
 identity=value.id;pageFor=value.page;
 const host=document.createElement('section');host.id='ownerEquipmentTransfers';
 const header=value.page.querySelector('.ownerAppPageHeader');
 if(header)header.after(host);else value.page.prepend(host);
 mounted=host;dispose=mountTransferDesk(host,value.c,{role:'it'});
}
function schedule(){if(queued)return;queued=true;queueMicrotask(()=>{queued=false;sync();});}
new MutationObserver(schedule).observe(document.body,{childList:true,subtree:true,attributes:true,attributeFilter:['class','data-owner-route']});
for(const event of ['techcheck:view-changed','techcheck:data-refreshed','pageshow','online'])window.addEventListener(event,schedule);
schedule();
