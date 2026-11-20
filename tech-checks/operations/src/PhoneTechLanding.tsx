import FleetCountReadout from './FleetCountReadout';
import TechnicianTodoList from './TechnicianTodoList';
import type {PhoneBoardCounts} from './phoneTechLanding';
import {IN_SHOP_LABEL} from './sharedFleetCounts';
import type {TechnicianTodo} from './technicianTodos';

/** First screen on a phone. Desktop and TV hide this with CSS. */
export default function PhoneTechLanding({counts, todos, onOpen}:{counts: PhoneBoardCounts; todos: TechnicianTodo[]; onOpen?: (todo: TechnicianTodo) => void}) {
  const units = counts.up === '—' ? null : { online: Number(counts.up), offline: Number(counts.down), unknown: Number(counts.unknown) };
  return <section className='cos-phone-landing' aria-label='Phone technician landing' data-problem-count={todos.length}>
    <FleetCountReadout units={units} cameras={counts.cameras}/>
    <p className='cos-phone-note' role='status'>{counts.note} <span className='cos-in-shop'>{IN_SHOP_LABEL}</span> units are not counted. Unknown is not offline.</p>
    <TechnicianTodoList todos={todos} onOpen={onOpen}/>
  </section>;
}
