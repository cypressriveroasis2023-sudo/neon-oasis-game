import {useState} from 'react';
import type {TechnicianTodo} from './technicianTodos';

/** Phone list of jobs that already have evidence. Unknown is never a row. */
export default function TechnicianTodoList({todos, onOpen}:{todos: TechnicianTodo[]; onOpen?: (todo: TechnicianTodo) => void}) {
  const [open, setOpen] = useState(false);
  const addresses = todos.filter(todo => todo.kind === 'mhelp_address');
  const rest = todos.filter(todo => todo.kind !== 'mhelp_address');
  const line = (todo: TechnicianTodo) => <li key={todo.id}>{onOpen
    ? <button type='button' onClick={() => onOpen(todo)}>{todo.kind === 'mhelp_address' ? 'Fix address in mHelpDesk — '+todo.unit : <>{todo.unit} — {todo.detail}</>}</button>
    : <><strong>{todo.unit}</strong> {todo.detail}</>}</li>;
  return <section className='cos-tech-todos' aria-label='Technician to-do'>
    <h2>To do</h2>
    {todos.length ? <ol>
      {rest.map(line)}
      {addresses.length === 1 && line(addresses[0])}
      {addresses.length > 1 && <li>
        <button type='button' aria-expanded={open} onClick={() => setOpen(value => !value)}>Fix {addresses.length} addresses in mHelpDesk</button>
        {open && <ol>{addresses.map(line)}</ol>}
      </li>}
    </ol> : <p>No evidence-backed jobs. Unknown readings stay off this list.</p>}
  </section>;
}
