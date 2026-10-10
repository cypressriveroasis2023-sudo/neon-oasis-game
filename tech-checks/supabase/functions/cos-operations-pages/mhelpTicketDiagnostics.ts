import {projectMhelpTicketDetailFailure} from './mhelpTicketDetail.ts';
import {MhelpTicketError} from './mhelpTickets.ts';
import {projectMhelpTicketSchema} from './mhelpTicketSchema.ts';

// Match only our own fixed parser messages. Never log a caught message, stack,
// response body, URL, request, identity or credential, even for unknown errors.
const REASONS = Object.freeze({
  'Unsupported mHelpDesk appointment evidence.':'APPOINTMENT_PROJECTION_INVALID',
  'mHelpDesk returned an oversized appointment page.':'APPOINTMENT_COUNT_LIMIT',
  'The appointment schedule window is not available.':'APPOINTMENT_WINDOW_INVALID',
  'mHelpDesk detail does not match the selected ticket.':'DETAIL_IDENTITY_MISMATCH',
  'mHelpDesk ticket changed during the detail preview.':'DETAIL_CHANGED',
  'mHelpDesk detail is outside the verified creation window.':'DETAIL_WINDOW_MISMATCH',
  'mHelpDesk returned an unsupported flat ticket detail.':'DETAIL_SCHEMA',
  'Unsupported mHelpDesk ticket detail evidence.':'DETAIL_PROJECTION_INVALID',
  'A mHelpDesk ticket preview is already running.':'BUSY',
  'mHelpDesk ticket configuration is unavailable.':'CONFIG_UNAVAILABLE',
  'mHelpDesk needs its existing server-held access token.':'TOKEN_UNAVAILABLE',
  'The saved mHelpDesk portal ID is invalid.':'PORTAL_CONFIGURATION',
  'The mHelpDesk account does not match the saved portal.':'PORTAL_MISMATCH',
  'The renewed mHelpDesk account does not match the saved portal.':'PORTAL_MISMATCH',
  'mHelpDesk returned a ticket from a different portal.':'PORTAL_MISMATCH',
  'mHelpDesk could not renew its existing server token.':'RENEWAL_FAILED',
  'mHelpDesk could not complete the ticket preview.':'TRANSPORT_FAILED',
  'The mHelpDesk ticket preview timed out.':'DEADLINE',
  'mHelpDesk returned an oversized ticket response.':'RESPONSE_TOO_LARGE',
  'mHelpDesk returned an incomplete ticket response.':'RESPONSE_INCOMPLETE',
  'mHelpDesk returned an unsupported ticket record.':'RECORD_SHAPE',
  'mHelpDesk returned an invalid ticket identity.':'IDENTITY_FORMAT',
  'mHelpDesk returned an unsupported ticket label.':'LABEL_FORMAT',
  'mHelpDesk returned an invalid timezone-bearing ticket timestamp.':'TIMESTAMP_TIMEZONE',
  'mHelpDesk returned an invalid ticket timestamp.':'TIMESTAMP_FORMAT',
  'mHelpDesk returned inconsistent ticket timestamps.':'TIMESTAMP_ORDER',
  'mHelpDesk returned an unsupported ticket deletion state.':'DELETION_STATE',
  'mHelpDesk returned an incomplete ticket type dictionary.':'TYPE_DICTIONARY_INCOMPLETE',
  'mHelpDesk returned an invalid ticket type dictionary.':'TYPE_DICTIONARY_INVALID',
  'mHelpDesk returned duplicate ticket type identities.':'TYPE_DICTIONARY_DUPLICATE',
  'mHelpDesk returned an unsupported ticket status dictionary.':'STATUS_DICTIONARY_SHAPE',
  'mHelpDesk returned an invalid ticket status dictionary.':'STATUS_DICTIONARY_INVALID',
  'mHelpDesk returned inconsistent ticket status identities.':'STATUS_DICTIONARY_IDENTITIES',
  'mHelpDesk returned an unsupported ticket page.':'PAGE_SHAPE',
  'The ticket preview exceeds its maximum count. Use a smaller creation window.':'COUNT_LIMIT',
  'mHelpDesk ticket totals changed during the preview. Retry.':'TOTAL_CHANGED',
  'mHelpDesk returned tickets outside the requested creation window.':'WINDOW_MISMATCH',
  'mHelpDesk did not return tickets in stable identity order.':'IDENTITY_ORDER',
  'mHelpDesk returned overlapping or incomplete ticket pages.':'PAGE_OVERLAP',
  'mHelpDesk returned duplicate ticket identities.':'IDENTITY_DUPLICATE',
  'mHelpDesk returned an incomplete ticket page.':'PAGE_INCOMPLETE',
  'Unsupported mHelpDesk ticket preview.':'PROJECTION_INVALID',
  'Unsupported mHelpDesk ticket preview count.':'PROJECTION_INVALID',
  'Incomplete mHelpDesk ticket preview.':'PROJECTION_INVALID',
  'Unsupported mHelpDesk ticket preview dictionaries.':'PROJECTION_INVALID',
  'Inconsistent mHelpDesk ticket preview counts.':'PROJECTION_INVALID',
  'Provide a bounded ticket creation window.':'WINDOW_INVALID',
  'Provide timezone-bearing ticket creation dates.':'WINDOW_INVALID',
  'Use a ticket window of at most 31 days and a limit from 1 to 500.':'WINDOW_INVALID',
  'The ticket preview request contains unsupported fields.':'WINDOW_INVALID',
});
const OPERATIONS = ['appointment_read','ticket_detail_read','account_read','ticket_read','ticket_types_read','ticket_statuses_read'] as const;
export const MHELP_PREVIEW_DIAGNOSTIC_CODES = Object.freeze([...new Set([
  ...Object.values(REASONS),'PROVIDER_HTTP','RATE_LIMIT','INTERNAL_FAILURE',
])]);
export function mhelpTicketDiagnostic(cause: unknown) {
  let code='INTERNAL_FAILURE',httpStatus=503;
  let operation:typeof OPERATIONS[number]|null=null,providerHttpStatus:number|null=null;
  if(cause instanceof MhelpTicketError) {
    if([400,409,429,503].includes(cause.status))httpStatus=cause.status;
    if(Object.hasOwn(REASONS,cause.message))code=REASONS[cause.message as keyof typeof REASONS];
    if(cause.message==='mHelpDesk is limiting ticket reads. Retry later.')code='RATE_LIMIT';
    if(cause.message==='mHelpDesk denied or could not complete the ticket read.')code='PROVIDER_HTTP';
    if(cause.provider && OPERATIONS.includes(cause.provider.operation) &&
      Number.isInteger(cause.provider.httpStatus) && cause.provider.httpStatus>=100 && cause.provider.httpStatus<=599) {
      operation=cause.provider.operation;providerHttpStatus=cause.provider.httpStatus;
    }
  }
  return {error:'MHELP_PREVIEW_'+code,httpStatus,
    log:{event:'mhelp_ticket_preview_failed',code,httpStatus,operation,providerHttpStatus,
      ...(cause instanceof MhelpTicketError && cause.schema?{schema:projectMhelpTicketSchema(cause.schema)}:{}),
      ...(cause instanceof MhelpTicketError && cause.detailSchema?{detailSchema:projectMhelpTicketDetailFailure(cause.detailSchema)}:{})}};
}
