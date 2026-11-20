import FleetCountReadout from './FleetCountReadout';
import TechnicianTodoList from './TechnicianTodoList';
import type {PhoneBoardCounts} from './phoneTechLanding';
import {IN_SHOP_LABEL} from './sharedFleetCounts';
import type {TechnicianTodo} from './technicianTodos';

/** First screen on a phone. Desktop and TV hide this with CSS. */
export default function PhoneTechLanding({counts, todos, onOpen, delayedLine, placementReadAt}:{counts: PhoneBoardCounts; todos: TechnicianTodo[]; onOpen?: (todo: TechnicianTodo) => void; delayedLine?: string | null; placementReadAt?: number | null}) {
  const units = counts.up === '—' ? null : { online: Number(counts.up), offline: Number(counts.down), unknown: Number(counts.unknown) };
  return <section className='cos-phone-landing' aria-label='Phone technician landing'>
    {delayedLine&&<p className='cos-updates-delayed' role='status'>{delayedLine}</p>}
    <FleetCountReadout units={units} cameras={counts.cameras} placementReadAt={delayedLine?placementReadAt??null:undefined}/>
    <p className='cos-phone-note' role='status'>{counts.note} <span className='cos-in-shop'>{IN_SHOP_LABEL}</span> units are not counted. Unknown is not offline.</p>
    <TechnicianTodoList todos={todos} onOpen={onOpen}/>
  </section>;
}
