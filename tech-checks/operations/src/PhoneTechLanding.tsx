import TechnicianTodoList from './TechnicianTodoList';
import type {PhoneBoardCounts} from './phoneTechLanding';
import type {TechnicianTodo} from './technicianTodos';

/** First screen on a phone. Desktop and TV hide this with CSS. */
export default function PhoneTechLanding({counts, todos}:{counts: PhoneBoardCounts; todos: TechnicianTodo[]}) {
  return <section className='cos-phone-landing' aria-label='Phone technician landing'>
    <div className='cos-phone-counts' role='group' aria-label='Field units up, down and unknown'>
      <div><b>{counts.up}</b><span>Up</span></div>
      <div><b>{counts.down}</b><span>Down</span></div>
      <div><b>{counts.unknown}</b><span>Unknown</span></div>
    </div>
    <p className='cos-phone-note' role='status'>{counts.note} Shop units are not counted as outages. Unknown is not offline.</p>
    <TechnicianTodoList todos={todos}/>
  </section>;
}
