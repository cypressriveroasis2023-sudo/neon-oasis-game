// One button's worth of answers about a unit.
//
// Troubleshooting a stand used to mean reading five panels and holding the
// result in your head. This gathers what COS already knows, judges each part
// on its own, and says the one thing to do next.
//
// Two rules this file exists to keep:
//
//   A router answering is not proof the cameras work. The two are separate
//   checks and neither is allowed to decide the other.
//
//   A check that did not happen is Unknown. It is never reported as a fault.
//   Silence is not evidence.
import type {UnitCameraStatus} from '../shared/starUnitStatus';
import {unitName} from './cameraStatusFilters';

export type CheckVerdict='pass'|'fail'|'warn'|'unknown';

export type UnitCheck={
 id:string;
 label:string;
 verdict:CheckVerdict;
 detail:string;
 /** A single action a person can take about this check, where one exists. */
 action?:{id:string;label:string};
};

export type TroubleshootResult={
 checks:UnitCheck[];
 /** Plain words: the one thing worth doing, or why nothing is. */
 advice:string;
 /** How many checks could not be made. Shown so a clean run is not confused
  * with a run that mostly could not see anything. */
 unknowns:number;
 failures:number;
};

const plural=(n:number,one:string,many=one+'s')=>n+' '+(n===1?one:many);

function cameraCheck(unit:UnitCameraStatus):UnitCheck{
 const total=unit.cameras||0,on=unit.online||0,off=unit.offline||0;
 if(!total)return {id:'cameras',label:'Cameras',verdict:'unknown',detail:'No cameras recorded on this unit'};
 if(unit.state==='UNKNOWN')return {id:'cameras',label:'Cameras',verdict:'unknown',
  detail:'Not verified on the last check'};
 if(off<=0)return {id:'cameras',label:'Cameras',verdict:'pass',detail:'all '+plural(total,'camera')+' reporting'};
 const named=unit.down?.map(camera=>camera?.name).filter(Boolean) as string[]|undefined;
 const who=named&&named.length?' · '+named.slice(0,2).join(', ')+(named.length>2?' +'+(named.length-2):''):'';
 return {id:'cameras',label:'Cameras',verdict:off>=total?'fail':'fail',
  detail:on+' of '+total+' reporting'+who,action:{id:'swap',label:'Swap'}};
}

/**
 * What mHelp holds about this unit's placement.
 * The useful case is disagreement: mHelp is the record of record, so when it
 * says Shop and the board is treating the unit as a field outage, the record
 * is what needs correcting, not the stand.
 */
function mhelpCheck(unit:UnitCameraStatus,mhelp?:{seenAt?:string|null;placement?:'FIELD'|'SHOP'|null;reviewReason?:string|null}):UnitCheck{
 if(!mhelp)return {id:'mhelp',label:'mHelp location',verdict:'unknown',detail:'No current evidence'};
 const seen=mhelp.seenAt?' · confirmed '+mhelp.seenAt.slice(0,10):'';
 if(mhelp.placement&&mhelp.placement!==unit.placement)
  return {id:'mhelp',label:'mHelp location',verdict:'warn',
   detail:'mHelp says '+(mhelp.placement==='SHOP'?'shop':'field')+', the board shows '+
    (unit.placement==='SHOP'?'shop':'field')+seen,action:{id:'placement',label:'Fix'}};
 if(mhelp.reviewReason)
  return {id:'mhelp',label:'mHelp location',verdict:'warn',detail:'Held for review · '+mhelp.reviewReason};
 if(!mhelp.placement)
  return {id:'mhelp',label:'mHelp location',verdict:'unknown',detail:'No placement recorded'};
 return {id:'mhelp',label:'mHelp location',verdict:'pass',
  detail:(mhelp.placement==='SHOP'?'Shop':'Field')+' in mHelp'+seen};
}

function addressCheck(unit:UnitCameraStatus):UnitCheck{
 const pinned=unit.location&&typeof unit.location.latitude==='number'&&typeof unit.location.longitude==='number';
 const text=(unit.address||'').trim();
 if(pinned)return {id:'address',label:'Address',verdict:'pass',detail:text||'On the map'};
 if(text)return {id:'address',label:'Address',verdict:'warn',
  detail:text+' · not on the map',action:{id:'address',label:'Fix'}};
 return {id:'address',label:'Address',verdict:'fail',detail:'None on file',action:{id:'address',label:'Add'}};
}

/**
 * Every check for one unit, in the order a person reads them.
 * `routerLinked` and `portsAnswered` come from the router and port evidence the
 * board already holds; pass undefined where that evidence was not read, and the
 * check reports Unknown rather than inventing a result.
 */
export function troubleshootUnit(unit:UnitCameraStatus,evidence:{
 routerLinked?:boolean;portsAnswered?:boolean[];ipAnswered?:boolean;
 mhelp?:{seenAt?:string|null;placement?:'FIELD'|'SHOP'|null;reviewReason?:string|null};
}={}):TroubleshootResult{
 const checks:UnitCheck[]=[];

 checks.push(unit.observedAt
  ?{id:'feed',label:'Provider',verdict:unit.state==='UNKNOWN'?'unknown':'pass',
    detail:unit.state==='UNKNOWN'?'No current reading':'Reported '+unit.observedAt}
  :{id:'feed',label:'Provider',verdict:'unknown',detail:'No reading on file'});

 checks.push(cameraCheck(unit));

 const ip=(unit.publicIp||'').trim();
 checks.push(!ip
  ?{id:'ip',label:'Public IP',verdict:'warn',detail:'None recorded',action:{id:'ip',label:'Add'}}
  :evidence.ipAnswered===undefined
   ?{id:'ip',label:'Public IP',verdict:'unknown',detail:ip+' · not checked'}
   :{id:'ip',label:'Public IP',verdict:evidence.ipAnswered?'pass':'fail',
     detail:ip+(evidence.ipAnswered?' answered':' did not answer')});

 const ports=evidence.portsAnswered;
 checks.push(!ports||!ports.length
  ?{id:'ports',label:'Ports',verdict:'unknown',detail:'Not checked'}
  :{id:'ports',label:'Ports',verdict:ports.every(Boolean)?'pass':ports.some(Boolean)?'warn':'fail',
    detail:ports.filter(Boolean).length+' of '+ports.length+' answered'});

 // A router is its own question. Whatever it says, it never decides whether a
 // camera is up, and a unit with no router is not therefore broken.
 checks.push(evidence.routerLinked===undefined
  ?{id:'router',label:'Router',verdict:'unknown',detail:'Not checked'}
  :evidence.routerLinked
   ?{id:'router',label:'Router',verdict:'pass',detail:'Linked · a router answering is not proof the cameras work'}
   :{id:'router',label:'Router',verdict:'warn',detail:'None linked',action:{id:'router',label:'Link'}});

 checks.push(addressCheck(unit));

 checks.push({id:'placement',label:'Placement',verdict:unit.placement==='FIELD'?'pass':'warn',
  detail:unit.placement==='FIELD'?'Field'+(unit.site?' · '+unit.site:''):'Shop · not a customer outage'});

 checks.push(mhelpCheck(unit,evidence.mhelp));

 const failures=checks.filter(check=>check.verdict==='fail').length;
 const unknowns=checks.filter(check=>check.verdict==='unknown').length;
 return {checks,failures,unknowns,advice:adviceFor(unit,checks,failures,unknowns)};
}

/** The one sentence worth reading. Ordered by what actually costs the customer. */
function adviceFor(unit:UnitCameraStatus,checks:UnitCheck[],failures:number,unknowns:number):string{
 const by=(id:string)=>checks.find(check=>check.id===id);
 const name=unitName(unit);
 const cameras=by('cameras');
 if(unit.placement==='SHOP')
  return name+' is in the shop, so none of this is a customer outage. Leave it for manual review.';
 if(by('mhelp')?.verdict==='warn'&&/mHelp says/.test(by('mhelp')!.detail))
  return 'mHelp and the board disagree about where '+name+' is. mHelp is the record of record, so correct the placement before judging anything else here.';
 if(cameras?.verdict==='fail'){
  const out=unit.offline||0,total=unit.cameras||0;
  const where=(unit.address||'').trim()?'':' It also has no address on file, so it will not pin.';
  return out>=total
   ? 'Every camera on '+name+' is down. Check power and the connection at the site before swapping anything.'+where
   : plural(out,'camera')+' down on '+name+' while the rest answer. Swap the one that is out.'+where;
 }
 if(cameras?.verdict==='unknown')
  return 'Nothing has been heard from '+name+' recently, which is not the same as it being down. Get a current reading before sending anyone.';
 if(by('address')?.verdict==='fail')
  return name+' is answering fine but has no address on file, so it is not on the map. Give it the site address.';
 if(failures===0&&unknowns>=3)
  return 'Nothing is failing on '+name+', but '+unknowns+' checks could not be made, so this is not a clean bill of health.';
 if(failures===0)
  return name+' checks out. Every camera is reporting and it is where it should be.';
 return 'Review the failed checks on '+name+' above.';
}
