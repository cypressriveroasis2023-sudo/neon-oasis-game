import {useEffect,useState} from 'react';
import {fleetMapStageActive,FLEET_BOARD_MIN_WIDTH_PX,stageIcon,unitsForBox,type StageBox,type StageBoxId,type StageUnitInput} from './fleetMapStage';
import './fleetMapStage.css';

export function useFleetMapStage(){
  const query = `(min-width: ${FLEET_BOARD_MIN_WIDTH_PX}px)`;
  const [wide,setWide] = useState(()=>typeof matchMedia==='function'&&matchMedia(query).matches);
  useEffect(()=>{
    if(typeof matchMedia!=='function')return;
    const media = matchMedia(query);
    const apply = ()=>setWide(media.matches);
    apply();
    media.addEventListener('change',apply);
    return ()=>media.removeEventListener('change',apply);
  },[query]);
  return fleetMapStageActive(wide);
}

type Props = {
  units: readonly StageUnitInput[];
  boxes: readonly StageBox[];
  now: number;
  active: StageBoxId | null;
  selectedId: string | null;
  onBox: (id: StageBoxId)=>void;
  onUnit: (id: string)=>void;
  onClose: ()=>void;
};

export default function FleetMapStage({units,boxes,now,active,selectedId,onBox,onUnit,onClose}:Props){
  const open = Boolean(active || selectedId);
  useEffect(()=>{
    if(!open)return;
    const onKey = (event: KeyboardEvent)=>{ if(event.key==='Escape') onClose(); };
    window.addEventListener('keydown', onKey);
    return ()=>window.removeEventListener('keydown', onKey);
  },[open,onClose]);
  const listed = active?unitsForBox(units,active):[];
  const selected = selectedId?units.find(unit=>unit.id===selectedId)||null:null;
  const selectedIcon = selected?stageIcon(selected,now):null;
  return <div className='cos-stage'>
    <div className='cos-stage-counts' aria-label='Fleet stage counts'>
      {boxes.map(box=><button key={box.id} type='button' className={'cos-stage-count cos-stage-count-'+box.tone} data-stage-box={box.id} aria-pressed={active===box.id} onClick={()=>onBox(box.id)}>
        <strong>{box.value}</strong>
        <span>{box.label}</span>
        <small>{box.source}</small>
      </button>)}
    </div>
    {(active||selected)&&<aside className='cos-stage-drawer' aria-label='Filtered fleet list'>
      <button type='button' className='cos-stage-close' onClick={onClose}>Close</button>
      <h2>{active?boxes.find(box=>box.id===active)?.label:'Unit'}</h2>
      <p className='cos-stage-drawer-note'>{active?boxes.find(box=>box.id===active)?.source+'. '+listed.length+' in this list.':'Selected from the map.'}</p>
      {selected&&selectedIcon&&<section className='cos-stage-details' aria-label='Unit details'>
        <h3>{selected.name}</h3>
        <p>{selected.site}</p>
        <dl>
          <div><dt>Status</dt><dd data-stage-icon={selectedIcon.icon}>{selectedIcon.label}</dd></div>
          <div><dt>Placement</dt><dd>{selected.placement==='shop'?'In shop':selected.placement==='field'?'Field':'Other'}</dd></div>
          <div><dt>Source</dt><dd>{selected.immix?'Immix':selected.inWatchful===true?'Watchful · mHelp field':selected.inWatchful===false?'mHelp':'mHelp placement'}</dd></div>
        </dl>
      </section>}
      <ul className='cos-stage-list'>
        {listed.map(unit=>{
          const icon = stageIcon(unit,now);
          return <li key={unit.id}><button type='button' data-unit-id={unit.id} data-stage-icon={icon.icon} aria-current={selectedId===unit.id} onClick={()=>onUnit(unit.id)}>
            <span><strong>{unit.name}</strong><small>{unit.site}</small><small>{icon.label}</small></span>
            <i className='cos-stage-dot' style={{background:icon.color}} aria-hidden='true'/>
          </button></li>;
        })}
      </ul>
      {!listed.length&&<p className='cos-stage-drawer-note'>Nothing in this group is on the current board.</p>}
    </aside>}
  </div>;
}
