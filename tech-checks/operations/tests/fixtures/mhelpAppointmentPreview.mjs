import {describeMhelpAppointments,unavailableMhelpAppointments} from '../../../supabase/functions/cos-operations-pages/mhelpAppointments.ts';
export const syntheticAppointment=(overrides={})=>({ID:991234,TicketId:781234,PortalId:224643,UserId:'synthetic-private-user',StartUTC:'2026-10-11T12:00:00Z',EndUTC:'2026-10-11T13:00:00Z',TeamId:null,RecurrenceRule:null,RecurrenceParentID:null,RecurrenceStartUTC:null,RecurrenceEndUTC:null,TimeZone:7,AppointmentTimeZone:'synthetic-private-timezone',IsAllDay:false,LastUpdate:'2026-10-09T13:00:00Z',IsDeleted:false,IsHidden:false,...overrides});
/** Synthetic structural evidence only; no real source records. */
export function appointmentEvidenceFixture({count=1,createdAfter='2026-10-09T05:00:00.000Z',appointments=[syntheticAppointment()],reportedTotal=appointments.length}={}) {
 return count===1?describeMhelpAppointments({TotalRows:reportedTotal,results:appointments},{ticketId:'781234',portalId:'224643',deleted:false},createdAfter):unavailableMhelpAppointments(count,createdAfter);
}
