// What the board puts in front of you first.
//
// The redesign opens with one card: the units a person has to do something
// about, worst first, with the site and what is wrong on one line each. It is
// derived from the same units the list below it shows, so the card and the
// rows can never disagree.
import type {UnitCameraStatus} from '../shared/starUnitStatus';
import {unitName} from './cameraStatusFilters';

export type NeedsYouTone='down'|'partial'|'unchecked';

export type NeedsYouRow={
 unit:string;
 name:string;
 site:string;
 detail:string;
 tone:NeedsYouTone;
};

/** Worst first: every camera down, then some down, then never verified. Within
 * a tone the unit with more cameras out comes first, so a stand with five dead
 * cameras outranks one with a single camera out. */
const TONE_ORDER:Record<NeedsYouTone,number>={down:0,partial:1,unchecked:2};

function toneOf(unit:UnitCameraStatus):NeedsYouTone|null{
 if(unit.state==='RED')return 'down';
 if(unit.state==='YELLOW')return 'partial';
 // A check that did not happen is Unknown. It is never reported as an outage.
 if(unit.state==='UNKNOWN')return 'unchecked';
 return null;
}

function detailOf(unit:UnitCameraStatus,tone:NeedsYouTone):string{
 const out=unit.offline||0,all=unit.cameras||0;
 if(tone==='down')return all>1?'all '+all+' cameras down':'camera down';
 if(tone==='partial')return out+' of '+all+' down';
 return 'not verified';
}

/**
 * The attention list for the top card.
 * Field units only: a unit in the shop is never a customer outage, however it
 * reports. `limit` caps what the card shows; the count returned is the whole
 * list, so the badge can say 12 while the card shows 5.
 */
export function needsYouRows(units:UnitCameraStatus[],limit=5):{rows:NeedsYouRow[];total:number}{
 const all:{row:NeedsYouRow;rank:number;out:number}[]=[];
 for(const unit of units){
  if(unit.placement!=='FIELD')continue;
  const tone=toneOf(unit);
  if(!tone)continue;
  all.push({
   row:{unit:unit.unit,name:unitName(unit),site:(unit.site||'').trim()||'No site recorded',
        detail:detailOf(unit,tone),tone},
   rank:TONE_ORDER[tone],
   out:unit.offline||0,
  });
 }
 all.sort((a,b)=>a.rank-b.rank||b.out-a.out||a.row.name.localeCompare(b.row.name));
 return {rows:all.slice(0,Math.max(0,limit)).map(entry=>entry.row),total:all.length};
}
