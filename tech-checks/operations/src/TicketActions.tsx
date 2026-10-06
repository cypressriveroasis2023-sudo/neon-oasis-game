import { ticketTypes, type TicketType } from './ticketTypes';
import './ticketActions.css';

export default function TicketActions({ createTicket }: { createTicket: (type: TicketType) => void }) {
  return <section className='dashboard-ticket-actions' aria-label='Create ticket'>
    <div className='dashboard-ticket-heading'><div><h2>Create ticket</h2><p>Choose the work you need. Review the details before creating a COS job.</p></div><span>OWNER TOOLS</span></div>
    <div className='dashboard-ticket-grid'>{ticketTypes.map(type => <button type='button' key={type.value} onClick={() => createTicket(type.value)} aria-label={'Create ' + type.label.toLowerCase() + ' ticket'}>
      <strong><span aria-hidden='true'>＋</span> {type.label}</strong><small>{type.description}</small>
    </button>)}</div>
  </section>;
}
