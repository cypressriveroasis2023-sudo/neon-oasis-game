import type {TechnicianTodo, TodoGroup} from './technicianTodos';

const GROUP_LABEL: Record<TodoGroup, string> = { offline: 'Offline', cleanup: 'Data cleanup' };

const groupOf = (todo: TechnicianTodo): TodoGroup => todo.group ?? (todo.kind === 'mhelp_address' || todo.kind === 'sim_cancel' ? 'cleanup' : 'offline');
const severityOf = (todo: TechnicianTodo) => todo.severity ?? (groupOf(todo) === 'offline' ? 'offline' : 'cleanup');

function card(todo: TechnicianTodo, onOpen?: (todo: TechnicianTodo) => void) {
  const title = todo.kind === 'sim_cancel' ? todo.detail : todo.unit;
  const reason = todo.kind === 'sim_cancel' ? 'SIM cancellation is still open.' : todo.detail;
  return <li key={todo.id} className={'cos-todo-card cos-todo-'+severityOf(todo)}>
    <i className='cos-todo-severity' aria-hidden='true'/>
    <span className='cos-todo-copy'>
      <strong>{title}</strong>
      <span>{reason}</span>
    </span>
    <button type='button' onClick={() => onOpen?.(todo)}>{todo.action || (todo.kind === 'sim_cancel' ? 'Cancel SIM' : 'Open')}</button>
  </li>;
}

/** Offline problems sit above address and other data cleanup. Shop never appears. */
export default function TechnicianTodoList({todos, onOpen}:{todos: TechnicianTodo[]; onOpen?: (todo: TechnicianTodo) => void}) {
  const groups: TodoGroup[] = ['offline', 'cleanup'];
  return <section className='cos-tech-todos' aria-label='Technician to-do'>
    <h2>To do</h2>
    {todos.length ? groups.map(group => {
      const items = todos.filter(todo => groupOf(todo) === group);
      if (!items.length) return null;
      return <div key={group} className='cos-todo-group'>
        <h3>{GROUP_LABEL[group]}</h3>
        <ul className='cos-todo-cards'>{items.map(todo => card(todo, onOpen))}</ul>
      </div>;
    }) : <p>No evidence-backed jobs. Unknown readings stay off this list.</p>}
  </section>;
}
