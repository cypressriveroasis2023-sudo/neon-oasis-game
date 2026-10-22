import {mountCorrectionDesk} from './transfers/corrections.js';

// This persistent Owner surface is outside ownerRouteView, whose legacy render
// replaces its HTML on refresh. Drafts and in-flight saves survive same-account
// refreshes, while an account/role/route change disposes the private surface.
let host=null,dispose=null,actor=null,authSubject,authObserved=false,scheduled=false;
const context=()=>window.TechCheckContext;
const visible=node=>Boolean(node&&!node.hidden&&!node.classList.contains('hidden')&&node.style.display!=='none');
function stop(){dispose?.();dispose=null;host?.remove();host=null;actor=null;}
function present(){
  const c=context();
  if(!authObserved&&c?.db?.auth?.onAuthStateChange){authObserved=true;c.db.auth.onAuthStateChange((event,session)=>{authSubject=session?.user?.id||null;queueMicrotask(present);});}
  const id=c?.getSession()?.user?.id,p=c?.getProfile(),view=document.getElementById('view-owner'),page=document.getElementById('ownerAppPage');
  const actualOwner=id&&(authSubject===undefined||authSubject===id)&&c.getRole()==='owner'&&p?.user_id===id&&p.active===true&&!p.archived_at&&(!c.getEffectiveRole||c.getEffectiveRole()==='owner')&&!document.body.classList.contains('owner-test-role-preview');
  if(!actualOwner||!page||!visible(document.getElementById('appView'))||!visible(view)||view.dataset.ownerRoute!=='handoffs'){stop();return;}
  if(host&&actor===id&&host.parentElement===page)return;
  stop();actor=id;host=document.createElement('section');host.id='cosOwnerHandoffCorrections';page.prepend(host);dispose=mountCorrectionDesk(host,c);
}
function schedule(){if(scheduled)return;scheduled=true;queueMicrotask(()=>{scheduled=false;present();});}
new MutationObserver(schedule).observe(document.body,{subtree:true,childList:true,attributes:true,attributeFilter:['class','style','data-owner-route','hidden']});
for(const event of ['techcheck:data-refreshed','techcheck:view-changed','pageshow','hashchange','popstate'])window.addEventListener(event,schedule);
present();
