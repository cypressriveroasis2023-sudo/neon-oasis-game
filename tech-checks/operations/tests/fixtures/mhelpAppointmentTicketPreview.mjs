import {ticketPreviewDetailFixture} from './mhelpTicketPreview.mjs';
import {appointmentEvidenceFixture} from './mhelpAppointmentPreview.mjs';
/** Synthetic full response; server projector supplies the fixed appointment DTO. */
export function ticketPreviewAppointmentFixture(options={}) {
  const count=options.count??1,preview=ticketPreviewDetailFixture({ticketCount:count});
  if(options.createdAfter)preview.window={createdAfter:options.createdAfter,createdBefore:'2026-10-09T05:00:00.000Z'};
  return {...preview,appointmentEvidence:appointmentEvidenceFixture({...options,count})};
}
