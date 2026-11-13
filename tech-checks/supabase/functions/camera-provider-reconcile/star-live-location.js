// Where Star4Live says a camera is right now. Read-only: nothing is written to
// Star4Live. The provider returns each resource's current organization id on
// every sync; the name is usually absent. The account's top organization is the
// shop ("root"); any other organization is a customer site.
//
// Before this, COS kept the site name it imported once and never moved a camera
// between Field and Shop, so a unit returned to the shop still showed its old
// customer, and a unit sent out still showed "root".
export const STAR_ROOT_ORGANIZATION_ID="283838";
const text=v=>typeof v==="string"||typeof v==="number"?String(v).trim():"";
const isRoot=v=>text(v).toLowerCase()==="root";
export const starPendingSiteName=id=>"Star4Live site #"+id+" (name pending)";
const pending=v=>/^Star4Live site #\S+ \(name pending\)$/.test(text(v));

/** Site names COS can still trust, by organization id: the name a strict
 * majority of that organization's cameras already carry (at least two cameras,
 * or the organization's only camera). A camera that just arrived carries the
 * name of where it came from, so a lone dissenting name never wins. */
export function starKnownSiteNames(resources,localBySerial,rootId=STAR_ROOT_ORGANIZATION_ID,verifiedNames=[]){
 // Names a person read off VCC for a specific Star4Live organization number. These
 // always win, and a carried-over name equal to a verified name of a DIFFERENT
 // organization is known to be stale and is never used.
 const verified=new Map();
 for(const row of Array.isArray(verifiedNames)?verifiedNames:[]){const id=text(row?.organization_id),name=text(row?.name);if(id&&id!==rootId&&name&&!isRoot(name)&&!pending(name))verified.set(id,name);}
 const verifiedOwner=new Map([...verified].map(([id,name])=>[name.toLowerCase(),id]));
 const votes=new Map();
 for(const r of Array.isArray(resources)?resources:[]){
  const id=text(r?.organizationId??r?.orgId);if(!id||id===rootId)continue;
  const given=text(r?.organizationName??r?.orgName);
  const local=localBySerial.get(text(r?.deviceSerial).toLowerCase());
  const name=given&&!isRoot(given)?given:local&&text(local.organization)&&!isRoot(local.organization)&&!pending(local.organization)
   &&text(local.source_metadata?.organizationId)===id?text(local.organization):"";
  const tally=votes.get(id)||{total:0,names:new Map(),given:""};tally.total++;
  if(given&&!isRoot(given))tally.given=given;
  if(name)tally.names.set(name,(tally.names.get(name)||0)+1);votes.set(id,tally);
 }
 const known=new Map(),claims=new Map();
 for(const [id,t] of votes){
  if(verified.has(id)){known.set(id,verified.get(id));continue;}
  if(t.given){known.set(id,t.given);continue;}
  const ranked=[...t.names].filter(([name])=>!verifiedOwner.has(name.toLowerCase())).sort((a,b)=>b[1]-a[1]);
  if(ranked.length&&ranked[0][1]*2>t.total&&(ranked[0][1]>=2||t.total===1)){
   const list=claims.get(ranked[0][0])||[];list.push({id,votes:ranked[0][1]});claims.set(ranked[0][0],list);
  }
 }
 // One carried-over name belongs to one organization. A camera that moved alone to
 // a new site still carries its old site's name; the organization with more
 // cameras under that name keeps it, and a tie names nobody.
 const provided=new Set(known.values());
 for(const [name,list] of claims){
  if(provided.has(name))continue;
  list.sort((a,b)=>b.votes-a.votes);
  if(list.length===1||list[0].votes>list[1].votes)known.set(list[0].id,name);
 }
 return known;
}

/** The organization text COS should store for one matched resource, or
 * undefined to leave the stored value alone (provider gave no organization). */
export function starLiveOrganization(resource,knownSiteNames,rootId=STAR_ROOT_ORGANIZATION_ID){
 const id=text(resource?.organizationId??resource?.orgId);
 if(!id)return undefined;
 if(id===rootId)return "root";
 const given=text(resource?.organizationName??resource?.orgName);
 if(given&&!isRoot(given))return given;
 return knownSiteNames.get(id)||starPendingSiteName(id);
}
