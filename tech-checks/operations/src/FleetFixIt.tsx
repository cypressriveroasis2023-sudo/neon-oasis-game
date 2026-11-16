// Few buttons, every edit behind them.
//
// A technician on a stand should not have to work out which of six fields to
// change. This is four plain choices in the words the job uses. Each one opens
// the panel on the single field it changes and says what will happen.
export type FixItAction='address'|'ip'|'placement'|'name';

const FIXES:{id:FixItAction;label:string;says:string;field:string}[]=[
 {id:'address',label:'Change where it is',
  says:'Set the site and street address. This is what puts the unit on the map.',field:'address'},
 {id:'ip',label:'Correct the public IP',
  says:'Fix the address the cameras answer on. Wrong here and the unit reads as down when it is not.',field:'ip'},
 {id:'placement',label:'Move it to the shop',
  says:'Mark it off a customer site. A unit in the shop is never counted as an outage.',field:'placement'},
 {id:'name',label:'Rename the unit',
  says:'Use the name on the sticker. The provider keeps its own name; this is the one COS shows.',field:'name'},
];

export default function FleetFixIt({unitKey,canEdit,onPick}:{
 unitKey:string;canEdit:boolean;onPick:(action:FixItAction,inputId:string)=>void;
}){
 if(!canEdit)return null;
 return <section className='cos-fixit' aria-label='Fix it'>
  <h4>FIX IT</h4>
  <ul>
   {FIXES.map(fix=><li key={fix.id}>
    <button type='button' onClick={()=>onPick(fix.id,fix.field+'-'+unitKey)}>
     <span className='cos-fixit-label'>{fix.label}</span>
     <span className='cos-fixit-says'>{fix.says}</span>
    </button>
   </li>)}
  </ul>
 </section>;
}
