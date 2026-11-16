import type {TechnicianTodo} from './technicianTodos';

/** Phone list of jobs that already have evidence. Unknown is never a row. */
export default function TechnicianTodoList({todos}:{todos: TechnicianTodo[]}) {
  return <section className='cos-tech-todos' aria-label='Technician to-do'>
    <h2>To do</h2>
    {todos.length ? <ol>{todos.map(todo => <li key={todo.id}><strong>{todo.unit}</strong> {todo.detail}</li>)}</ol>
      : <p>No evidence-backed jobs. Unknown readings stay off this list.</p>}
  </section>;
}
