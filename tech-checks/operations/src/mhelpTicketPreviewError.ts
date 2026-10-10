import {OperationsApiError} from './api';

const sourceReview='The mHelpDesk response format needs review before this preview can be verified.';
const typeReview='The mHelpDesk ticket-type dictionary needs review before this preview can be verified.';
const statusReview='The mHelpDesk ticket-status dictionary needs review before this preview can be verified.';
const connectionReview='The saved server-side mHelpDesk connection needs review before retrying this read.';
// Keep this client-only catalog aligned by test with the server allowlist. Never
// display a caught message, unknown code, raw response or provider description.
export const mhelpPreviewDiagnosticMessages=Object.freeze({
  BUSY:'Another ticket preview is running. Wait for it to finish, then try again.',
  CONFIG_UNAVAILABLE:connectionReview,
  TOKEN_UNAVAILABLE:connectionReview,
  PORTAL_CONFIGURATION:connectionReview,
  PORTAL_MISMATCH:'The mHelpDesk account does not match the saved portal. Review the connection before retrying.',
  RENEWAL_FAILED:'The existing mHelpDesk connection could not renew access. Review the server-side connection before retrying.',
  TRANSPORT_FAILED:'mHelpDesk could not complete this read. Wait a moment, then try again.',
  DEADLINE:'The ticket read timed out. Wait a moment, then try again.',
  RESPONSE_TOO_LARGE:'The ticket response exceeded the safe read limit. Review the preview limits before retrying.',
  RESPONSE_INCOMPLETE:'mHelpDesk returned an incomplete read. Wait a moment, then try again.',
  RECORD_SHAPE:sourceReview,
  IDENTITY_FORMAT:sourceReview,
  LABEL_FORMAT:sourceReview,
  TIMESTAMP_TIMEZONE:'The ticket timestamps do not include a supported timezone. Review the source date format before retrying.',
  TIMESTAMP_FORMAT:'The ticket timestamp format needs review before this preview can be verified.',
  TIMESTAMP_ORDER:'The ticket creation and update times are inconsistent. Review the source dates before retrying.',
  DELETION_STATE:sourceReview,
  TYPE_DICTIONARY_INCOMPLETE:typeReview,
  TYPE_DICTIONARY_INVALID:typeReview,
  TYPE_DICTIONARY_DUPLICATE:typeReview,
  STATUS_DICTIONARY_SHAPE:statusReview,
  STATUS_DICTIONARY_INVALID:statusReview,
  STATUS_DICTIONARY_IDENTITIES:statusReview,
  PAGE_SHAPE:sourceReview,
  COUNT_LIMIT:'The ticket count for the selected window exceeds the safe preview limit. Review the read limit before retrying.',
  TOTAL_CHANGED:'The ticket count changed during this read. Try the preview again.',
  WINDOW_MISMATCH:'mHelpDesk returned tickets outside the selected window. Review the source date filtering before retrying.',
  IDENTITY_ORDER:'The ticket page order could not be verified. Review source pagination before retrying.',
  PAGE_OVERLAP:'The ticket pages overlap or are incomplete. Review source pagination before retrying.',
  IDENTITY_DUPLICATE:'The ticket read contains duplicate identities. Review source pagination before retrying.',
  PAGE_INCOMPLETE:'mHelpDesk returned an incomplete ticket page. Try the preview again.',
  PROJECTION_INVALID:'The aggregate preview failed its safety checks. Review the preview contract before retrying.',
  WINDOW_INVALID:'The selected window could not be verified. Review the preview configuration before retrying.',
  PROVIDER_HTTP:'mHelpDesk could not complete this read. Review the server-side provider response status before retrying.',
  RATE_LIMIT:'mHelpDesk is limiting ticket reads. Wait a moment, then try again.',
  INTERNAL_FAILURE:'The ticket preview encountered an internal error. Review the server-side diagnostic before retrying.',
});
const generic='The ticket preview could not be verified. Try again.';
export function mhelpTicketPreviewErrorMessage(cause:unknown):string {
  if(!(cause instanceof OperationsApiError))return generic;
  const status=cause.response?.status;
  if([401,403].includes(status))return 'Your Owner session could not be verified. Return to Tech Check and sign in again.';
  if(status===429)return 'mHelpDesk is limiting ticket reads. Wait a moment, then try again.';
  if(![400,409,503].includes(status))return generic;
  const error=cause.response?.data?.error;
  for(const [code,message] of Object.entries(mhelpPreviewDiagnosticMessages)){
    const reference='MHELP_PREVIEW_'+code;
    if(error===reference)return message+' Reference: '+reference+'.';
  }
  return generic;
}
