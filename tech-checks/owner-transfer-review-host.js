import {mountOwnerReturnReviews} from './transfers/owner-reviews.js';
let root=null,dispose=null,scope='',scheduled=false,observedDb=null;
function present(){
 const c=window.TechCheckContext,v=document.getElementById('view-owner'),host=document.getElementById('ownerRouteView'),actor=c?.getSession()?.user?.id,p=c?.getProfile();
 if(c?.db&&observedDb!==c.db){observedDb=c.db;c.db.auth?.onAuthStateChange?.(()=>schedule());}
 const active=actor&&c.getRole()==='owner'&&c.getEffectiveRole()==='owner'&&p?.user_id===actor&&p.active===true&&!p.archived_at&&v&&!v.classList.contains('hidden')&&v.dataset.ownerRoute==='handoffs'&&host&&!document.body.classList.contains('owner-test-role-preview');
 const next=active?actor:'';
 if(scope===next&&(!next||root?.isConnected))return;
 dispose?.();dispose=null;root?.remove();root=null;scope=next;
 if(!next)return;
 root=document.createElement('section');root.className='ownerAppGroup';root.setAttribute('aria-label','Named handoff inventory reviews');host.append(root);dispose=mountOwnerReturnReviews(root,c);
}
const schedule=()=>{if(scheduled)return;scheduled=true;queueMicrotask(()=>{scheduled=false;present();});};
new MutationObserver(schedule).observe(document.body,{subtree:true,childList:true,attributes:true,attributeFilter:['class','data-owner-route']});
for(const event of ['techcheck:view-changed','techcheck:data-refreshed'])window.addEventListener(event,schedule);
schedule();
