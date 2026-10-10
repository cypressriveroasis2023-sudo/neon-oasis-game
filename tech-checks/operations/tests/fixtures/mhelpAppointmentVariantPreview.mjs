import {describeMhelpAppointmentVariants,unavailableMhelpAppointmentVariants} from '../../../supabase/functions/cos-operations-pages/mhelpAppointmentVariants.ts';
import {ticketPreviewAppointmentFixture} from './mhelpAppointmentTicketPreview.mjs';
/** Test-only lower-camel and ID/UTC hypotheses; no production records. */
export const syntheticVariantAppointment=(overrides={})=>({id:991234,ticketId:781234,portalId:224643,UserID:'aaaaaaaa-bbbb-cccc-dddd-eeeeeeeeeeee',userId:'synthetic-private@example.test',userID:'123456',startUtc:'2026-10-11T12:00:00Z',endUTC:'2026-10-11T13:00:00Z',isDeleted:false,isHidden:false,'synthetic-private-key':'synthetic-private-value',...overrides});
export function ticketPreviewAppointmentVariantFixture({count=1,createdAfter='2026-10-09T05:00:00.000Z',source={TotalRows:1,results:[syntheticVariantAppointment()],'synthetic-private-envelope':'synthetic-private-envelope-value'}}={}){
  const preview=ticketPreviewAppointmentFixture({count,...(createdAfter==='2026-10-09T05:00:00.000Z'?{}:{createdAfter})});
  preview.appointmentEvidence=count===1?describeMhelpAppointmentVariants(source,{ticketId:'781234',portalId:'224643',deleted:false},createdAfter):unavailableMhelpAppointmentVariants(count,createdAfter);
  return preview;
}
