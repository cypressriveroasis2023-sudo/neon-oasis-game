import test from 'node:test';
import assert from 'node:assert/strict';
import {readFileSync} from 'node:fs';
import {MhelpTicketError} from '../../supabase/functions/cos-operations-pages/mhelpTickets.ts';
import {mhelpTicketDiagnostic,MHELP_PREVIEW_DIAGNOSTIC_CODES} from '../../supabase/functions/cos-operations-pages/mhelpTicketDiagnostics.ts';
test('preview diagnostics contain only fixed code/status/operation fields',()=>{
 const d=mhelpTicketDiagnostic(new MhelpTicketError('mHelpDesk returned an invalid ticket status dictionary.'));
 assert.deepEqual(d,{error:'MHELP_PREVIEW_STATUS_DICTIONARY_INVALID',httpStatus:503,log:{event:'mhelp_ticket_preview_failed',code:'STATUS_DICTIONARY_INVALID',httpStatus:503,operation:null,providerHttpStatus:null}});
 assert(MHELP_PREVIEW_DIAGNOSTIC_CODES.every(code=>/^[A-Z_]+$/.test(code)));
});
test('unknown causes and credential-shaped messages, stacks and attached data are never exported',()=>{
 for(const cause of [new Error('Bearer synthetic-secret'),new MhelpTicketError('https://private.invalid/?token=synthetic-secret',599,{operation:'ticket_read',httpStatus:403}),{message:'private customer',status:401,provider:{operation:'ticket_read',httpStatus:200}},null]){
  if(cause instanceof Error)Object.assign(cause,{stack:'private stack synthetic-secret',body:{customer:'private'},headers:{Authorization:'Bearer synthetic-secret'},accessToken:'synthetic-secret'});
  const d=mhelpTicketDiagnostic(cause);assert.equal(d.error,'MHELP_PREVIEW_INTERNAL_FAILURE');assert.equal(d.httpStatus,503);
  for(const text of ['synthetic-secret','private','Authorization','customer','headers','stack','body','accessToken'])assert(!JSON.stringify(d).includes(text));
 }
});
test('provider operation and HTTP status are independently bounded, with no raw metadata forwarding',()=>{
 for(const provider of [{operation:'ticket_read',httpStatus:403,token:'synthetic-secret'},{operation:'https://private.invalid/',httpStatus:403},{operation:'ticket_read',httpStatus:999},{operation:'ticket_read',httpStatus:'403'}]){
  const d=mhelpTicketDiagnostic(new MhelpTicketError('mHelpDesk denied or could not complete the ticket read.',503,provider));
  assert.equal(d.error,'MHELP_PREVIEW_PROVIDER_HTTP');assert.equal(d.log.operation,provider.operation==='ticket_read'&&provider.httpStatus===403?'ticket_read':null);
  assert(!JSON.stringify(d).includes('synthetic-secret'));assert(!JSON.stringify(d).includes('private.invalid'));
 }
});
test('every fixed reader failure message is classified without needing live vendor data',()=>{
 const source=readFileSync(new URL('../../supabase/functions/cos-operations-pages/mhelpTickets.ts',import.meta.url),'utf8');
 for(const match of source.matchAll(/(?:fail|MhelpTicketError)\('([^']+)'/g)){
  if(match[1]==='Invalid portal')continue; // Caught locally and converted to the fixed configuration error.
  assert.notEqual(mhelpTicketDiagnostic(new MhelpTicketError(match[1])).error,'MHELP_PREVIEW_INTERNAL_FAILURE',match[1]);
 }
});
