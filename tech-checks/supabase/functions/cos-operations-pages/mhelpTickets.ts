/** Read-only ticket discovery. The caller must authenticate before invoking this reader.
 * Contract sources: https://www.mhelpdesk.com/partner-api/ticket.html,
 * ticket-type.html, ticket-status.html, models.html and request-formats.html.
 * This module has no persistence, scheduling, native workflow or vendor-write capability.
 */
import {describeMhelpTicketSchema,describeMhelpOperationalEvidence,projectMhelpOperationalEvidence,MHELP_OPERATIONAL_EVIDENCE} from './mhelpTicketSchema.ts';
export const MHELP_TICKET_CONTRACT = 'cos-mhelpdesk-ticket-preview-v1';
const API = 'https://connect.mhelpdesk.com/api/v1.0';
const CURRENT_USER = API + '/users/me';
const PAGE_SIZE = 50, MAX_TICKETS = 500, MAX_DICTIONARY_ROWS = 500;
const MAX_WINDOW_MS = 31 * 86400000;
type Row = Record<string, unknown>;
type Config = {portalId?: string; accessToken?: string};
type Operation = 'account_read' | 'ticket_read' | 'ticket_types_read' | 'ticket_statuses_read';
export class MhelpTicketError extends Error {
  schema?: Record<string,unknown>;
  constructor(message: string, public status = 503, public provider?: {operation: Operation; httpStatus: number}) { super(message); }
}
function fail(message: string, status = 503): never { throw new MhelpTicketError(message, status); }
const object = (value: unknown): Row => {
  if (!value || typeof value !== 'object' || Array.isArray(value)) fail('mHelpDesk returned an unsupported ticket record.');
  return value as Row;
};
function identity(value: unknown, allowZero = false): string {
  if (typeof value === 'number' && Number.isSafeInteger(value) && value >= (allowZero ? 0 : 1)) return String(value);
  if (typeof value === 'string' && /^(0|[1-9]\d{0,14})$/.test(value) && Number.isSafeInteger(Number(value)) && (allowZero || value !== '0')) return value;
  return fail('mHelpDesk returned an invalid ticket identity.');
}
const optionalId = (value: unknown): string | null => value == null || value === 0 || value === '0' ? null : identity(value);
function text(value: unknown, optional = false): string | null {
  if (optional && (value == null || value === '')) return null;
  if (typeof value !== 'string' || !value.trim() || value.length > 500 || /[\x00-\x1f\x7f]/.test(value)) fail('mHelpDesk returned an unsupported ticket label.');
  return value as string;
}
/** Require an actual timezone. Never interpret a naive vendor timestamp in server local time. */
function timestamp(value: unknown): string {
  if (typeof value !== 'string' || value.length > 40 || !/^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}:\d{2}(?:\.\d{1,7})?(?:Z|[+-]\d{2}:\d{2})$/.test(value) || !Number.isFinite(Date.parse(value))) fail('mHelpDesk returned an invalid timezone-bearing ticket timestamp.');
  // Date.parse accepts impossible calendar dates, so independently validate the local date.
  const [year,month,day] = value.slice(0,10).split('-').map(Number);
  if (year < 1900 || month < 1 || month > 12 || day < 1 || day > new Date(Date.UTC(year,month,0)).getUTCDate()) fail('mHelpDesk returned an invalid ticket timestamp.');
  return new Date(value).toISOString();
}
const KNOWN_TICKET_FIELDS = new Set(('ticketId assignedBy assignedTo categoryId statusId isPublic creationDate lastModDate priority summary neededBy scheduledDate moduleId submitterUsername subject estimatedTime customerId comment fromEmail newReplyFromEndUser newReplyFromStaff typeId customStatusId hasInvoice parentTicketId dataGroupId businessUnitId deleted submitterRole lastOpenedBy lastOpenedTime lastOpenedLocation originalTicketId recurringRuleId generatedByRecurring previousOrgId appointmentCount lastCalledDate nextCallDate portalId contactId poNumber ticketNumber serviceLocationId subTotal totalAmount totalTax totalProfitMargin totalROI totalProfit customFields items ticketStatus typeName').split(' '));
export type PartnerTicket = {
  portalId: string; ticketId: string; ticketNumber: string; typeId: string | null; typeName: string | null;
  statusId: string; customStatusId: string | null; deleted: boolean; creationDate: string; lastModDate: string;
  customerId: string | null; serviceLocationId: string | null;
  /** Vendor username only. This is not a COS user identity or an authorized assignment. */
  assignedTo: string | null; assignmentState:'assigned'|'unassigned'|'unknown'; unknownFieldCount: number;
};
/** Internal DTO only. Descriptions, contacts, custom fields and line items are discarded. */
export function projectPartnerTicket(value: unknown, portalId: string): PartnerTicket {
  const row = object(value);
  if (identity(row.portalId) !== portalId) fail('mHelpDesk returned a ticket from a different portal.');
  if (typeof row.deleted !== 'boolean') fail('mHelpDesk returned an unsupported ticket deletion state.');
  const creationDate = timestamp(row.creationDate), lastModDate = timestamp(row.lastModDate);
  if (Date.parse(lastModDate) < Date.parse(creationDate)) fail('mHelpDesk returned inconsistent ticket timestamps.');
  const assignedTo=text(row.assignedTo,true), assignmentKnown=Object.hasOwn(row,'assignedTo')&&row.assignedTo!==undefined;
  return {portalId, ticketId:identity(row.ticketId), ticketNumber:identity(row.ticketNumber), typeId:optionalId(row.typeId), typeName:text(row.typeName,true),
    statusId:identity(row.statusId,true), customStatusId:optionalId(row.customStatusId), deleted:row.deleted,
    creationDate,lastModDate,customerId:optionalId(row.customerId),serviceLocationId:optionalId(row.serviceLocationId),
    assignedTo,assignmentState:!assignmentKnown?'unknown':assignedTo===null?'unassigned':'assigned',
    unknownFieldCount:Object.keys(row).filter(key=>!KNOWN_TICKET_FIELDS.has(key)).length};
}
type TicketType = {typeId:string; portalId:string; typeName:string; isActive:boolean};
type TicketStatus = {statusId:string; statusText:string; displayText:string; parentId:string|null; canBeParent:boolean};
/** Accept the documented data collection or the results collection observed by the
 * authorized Owner preview. Never guess between both, fall back from malformed
 * data, or infer ticket-row/timezone/pagination semantics from an empty sample. */
function collectionRows(page: Row): unknown[] | null {
  const hasData=Object.hasOwn(page,'data'),hasResults=Object.hasOwn(page,'results');
  if (hasData===hasResults) return null;
  const rows=hasData?page.data:page.results;
  return Array.isArray(rows)?rows:null;
}
function types(value: unknown, portalId: string): TicketType[] {
  const page=object(value),rows=collectionRows(page);
  if (!Number.isSafeInteger(page.totalRows) || !rows || page.totalRows!==rows.length || rows.length>MAX_DICTIONARY_ROWS) fail('mHelpDesk returned an incomplete ticket type dictionary.');
  const result=rows.map(value=>{
    const row=object(value);
    if (identity(row.portalId)!==portalId || typeof row.isActive!=='boolean') fail('mHelpDesk returned an invalid ticket type dictionary.');
    return {typeId:identity(row.typeId),portalId,typeName:text(row.typeName)!,isActive:row.isActive};
  });
  if (new Set(result.map(row=>row.typeId)).size!==result.length) fail('mHelpDesk returned duplicate ticket type identities.');
  return result;
}
function statuses(value: unknown): TicketStatus[] {
  if (!Array.isArray(value) || value.length>MAX_DICTIONARY_ROWS) fail('mHelpDesk returned an unsupported ticket status dictionary.');
  const result=value.map(value=>{
    const row=object(value);
    if (typeof row.canBeParent!=='boolean') fail('mHelpDesk returned an invalid ticket status dictionary.');
    return {statusId:identity(row.statusId),statusText:text(row.statusText)!,displayText:text(row.displayText)!,parentId:optionalId(row.parentId),canBeParent:row.canBeParent};
  });
  const ids=new Set(result.map(row=>row.statusId));
  if (ids.size!==result.length || result.some(row=>row.parentId!==null && (!ids.has(row.parentId) || row.parentId===row.statusId))) fail('mHelpDesk returned inconsistent ticket status identities.');
  return result;
}
export type TicketPreviewWindow = {createdAfter:string; createdBefore:string; maxTickets?:number};
function windowOf(value: unknown) {
  let row:Row;
  try { row=object(value); } catch { return fail('Provide a bounded ticket creation window.',400); }
  if (Object.keys(row).some(key=>!['createdAfter','createdBefore','maxTickets'].includes(key))) fail('The ticket preview request contains unsupported fields.',400);
  let createdAfter:string,createdBefore:string;
  try { createdAfter=timestamp(row.createdAfter);createdBefore=timestamp(row.createdBefore); }
  catch { return fail('Provide timezone-bearing ticket creation dates.',400); }
  const duration=Date.parse(createdBefore)-Date.parse(createdAfter), maxTickets=row.maxTickets===undefined?MAX_TICKETS:row.maxTickets;
  if (duration<=0 || duration>MAX_WINDOW_MS || typeof maxTickets!=='number' || !Number.isSafeInteger(maxTickets) || maxTickets<1 || maxTickets>MAX_TICKETS) fail('Use a ticket window of at most 31 days and a limit from 1 to 500.',400);
  return {createdAfter,createdBefore,maxTickets};
}
const METRICS = ['deletedTickets','assignedTickets','missingAssignmentFields','missingTypeIds','unknownTypeIds','unknownStatusIds','unknownCustomStatusIds','missingCustomerIds','missingServiceLocationIds','ticketsWithUnknownFields','unknownFieldOccurrences','typeLabelMismatches','duplicateTypeNames'] as const;
/** Defense-in-depth allowlist for maintenance. Never spread an untrusted reader result. */
export function projectMhelpTicketPreview(value: unknown, evidence?:typeof MHELP_OPERATIONAL_EVIDENCE) {
  if(evidence!==undefined&&evidence!==MHELP_OPERATIONAL_EVIDENCE)fail('Unsupported mHelpDesk ticket preview.');
  const row=object(value);
  if(row.contract!==MHELP_TICKET_CONTRACT || row.state!=='preview_verified' || row.liveAccessVerified!==true || row.automaticSync!==false || row.ticketWrites!==false || row.partial!==false)fail('Unsupported mHelpDesk ticket preview.');
  const portalId=identity(row.verifiedPortalId),window=windowOf(row.window);
  const count=(value:unknown,max=MAX_TICKETS):number=>{
    if(typeof value!=='number' || !Number.isSafeInteger(value) || value<0 || value>max)fail('Unsupported mHelpDesk ticket preview count.');
    return value as number;
  };
  const totalRows=count(row.totalRows);
  if(count(row.previewCount)!==totalRows)fail('Incomplete mHelpDesk ticket preview.');
  if(!Array.isArray(row.types) || !Array.isArray(row.statuses))fail('Unsupported mHelpDesk ticket preview dictionaries.');
  const typeRows=types({totalRows:row.types.length,data:row.types},portalId).map((type,i)=>({...type,count:count(object((row.types as unknown[])[i]).count,totalRows)}));
  const statusRows=statuses(row.statuses).map((status,i)=>{
    const item=object((row.statuses as unknown[])[i]);
    return {...status,statusCount:count(item.statusCount,totalRows),customStatusCount:count(item.customStatusCount,totalRows)};
  });
  if(typeRows.reduce((sum,row)=>sum+row.count,0)>totalRows || statusRows.reduce((sum,row)=>sum+row.statusCount,0)>totalRows || statusRows.reduce((sum,row)=>sum+row.customStatusCount,0)>totalRows)fail('Inconsistent mHelpDesk ticket preview counts.');
  const inputMetrics=object(row.metrics),metrics={} as Record<typeof METRICS[number],number>;
  for(const key of METRICS)metrics[key]=count(inputMetrics[key],key==='unknownFieldOccurrences'?1000000:key==='duplicateTypeNames'?typeRows.length:totalRows);
  return {contract:MHELP_TICKET_CONTRACT,state:'preview_verified' as const,liveAccessVerified:true,automaticSync:false,ticketWrites:false,
    verifiedPortalId:portalId,readAt:timestamp(row.readAt),window:{createdAfter:window.createdAfter,createdBefore:window.createdBefore},
    totalRows,previewCount:totalRows,partial:false,types:typeRows,statuses:statusRows,metrics,
    ...(evidence===MHELP_OPERATIONAL_EVIDENCE?{operationalEvidence:projectMhelpOperationalEvidence(row.operationalEvidence,totalRows)}:{})};
}
/** Instantiate once and call only behind the existing protected maintenance/Owner gate. */
export function createMhelpTicketReader(options:{getConfig:()=>Config|Promise<Config>;renewAccess?:()=>Promise<Config>;fetch:typeof fetch}) {
  let busy=false;
  return {preview:async(value:TicketPreviewWindow,evidence?:typeof MHELP_OPERATIONAL_EVIDENCE)=>{
    const window=windowOf(value);
    if(evidence!==undefined&&evidence!==MHELP_OPERATIONAL_EVIDENCE)fail('The ticket preview request contains unsupported fields.',400);
    if(busy)fail('A mHelpDesk ticket preview is already running.',409);
    busy=true;
    const controller=new AbortController(), timer=setTimeout(()=>controller.abort(),20000);
    let budget=3*1048576;
    const schema:Record<string,unknown>={};
    try {
      let config:Config;
      try { config=await options.getConfig(); } catch { return fail('mHelpDesk ticket configuration is unavailable.'); }
      const validConfig=()=>{
        if(!config || typeof config.accessToken!=='string' || !config.accessToken || config.accessToken.length>16384 || /\s/.test(config.accessToken)) fail('mHelpDesk needs its existing server-held access token.');
        if(config.portalId!==undefined)try { if(identity(config.portalId)!==config.portalId)fail('Invalid portal'); } catch { fail('The saved mHelpDesk portal ID is invalid.'); }
      };
      validConfig();
      // Retain the configured portal constraint across renewal; renewed config cannot silently change it.
      const configuredPortalId=config.portalId;
      let renewed=false;
      const read=async(url:string,operation:Operation,maxBytes=1048576):Promise<unknown>=>{
        let response:Response;
        try {response=await options.fetch(url,{method:'GET',headers:{Authorization:'Bearer '+config.accessToken,Accept:'application/json'},redirect:'error',cache:'no-store',signal:controller.signal});}
        catch {return fail('mHelpDesk could not complete the ticket preview.');}
        if(response.status===401 && operation==='account_read' && options.renewAccess && !renewed){
          renewed=true;await response.body?.cancel().catch(()=>{});
          try {config=await options.renewAccess();} catch {return fail('mHelpDesk could not renew its existing server token.');}
          validConfig();
          if(configuredPortalId && config.portalId && config.portalId!==configuredPortalId)fail('The renewed mHelpDesk account does not match the saved portal.');
          return read(url,operation,maxBytes);
        }
        if(!response.ok){
          await response.body?.cancel().catch(()=>{});
          throw new MhelpTicketError(response.status===429?'mHelpDesk is limiting ticket reads. Retry later.':'mHelpDesk denied or could not complete the ticket read.',response.status===429?429:503,{operation,httpStatus:response.status});
        }
        if(!response.body || Number(response.headers.get('Content-Length'))>maxBytes){await response.body?.cancel().catch(()=>{});return fail('mHelpDesk returned an oversized ticket response.');}
        const reader=response.body.getReader(),decoder=new TextDecoder('utf-8',{fatal:true});let size=0,raw='';
        try {
          while(true){
            if(controller.signal.aborted)fail('The mHelpDesk ticket preview timed out.');
            const {value,done}=await reader.read();if(done)break;
            size+=value.byteLength;budget-=value.byteLength;
            if(size>maxBytes || budget<0){await reader.cancel();fail('mHelpDesk returned an oversized ticket response.');}
            raw+=decoder.decode(value,{stream:true});
          }
          raw+=decoder.decode();return JSON.parse(raw);
        }catch(error){if(error instanceof MhelpTicketError)throw error;return fail('mHelpDesk returned an incomplete ticket response.');}
        finally {await reader.cancel().catch(()=>{});reader.releaseLock();}
      };
      const account=object(await read(CURRENT_USER,'account_read',16384)), portalId=identity(account.portalId);
      if((configuredPortalId && configuredPortalId!==portalId) || (config.portalId && config.portalId!==portalId))fail('The mHelpDesk account does not match the saved portal.');
      const prefix=API+'/portal/'+portalId;
      const url=new URL(prefix+'/Tickets');
      // Published createStart/createEnd semantics are strictly greater/less than.
      // Future polling must overlap windows and deduplicate portalId+ticketId; adjacent
      // windows would omit exact-boundary tickets. This reader never advances a cursor.
      url.searchParams.set('createStart',window.createdAfter);url.searchParams.set('createEnd',window.createdBefore);
      url.searchParams.set('pageSize',String(PAGE_SIZE));url.searchParams.set('sort','ticketId');
      // Ticket docs do not advertise fields shaping. Never assume Equipment's Fields contract applies.
      // Inspect only already-authorized bounded reads. Gather fixed structural counts
      // before strict parsing so one failed dictionary does not hide later contract gaps.
      const rawTypes=await read(prefix+'/tickettypes','ticket_types_read');
      schema.ticketTypes=describeMhelpTicketSchema(rawTypes,'ticketTypes');
      const rawStatuses=await read(prefix+'/ticketstatus','ticket_statuses_read');
      schema.ticketStatuses=describeMhelpTicketSchema(rawStatuses,'ticketStatuses');
      const rawTickets=await read(url.href,'ticket_read');
      schema.tickets=describeMhelpTicketSchema(rawTickets,'tickets');
      const typeRows=types(rawTypes,portalId),statusRows=statuses(rawStatuses);
      let total:number|undefined,indexBase=0,boundaryChecked=false;
      const tickets:PartnerTicket[]=[],seen=new Set<string>();
      const pageOf=(value:unknown)=>{
        const page=object(value),collection=collectionRows(page);
        if(!Number.isSafeInteger(page.totalRows) || Number(page.totalRows)<0 || !collection || collection.length>PAGE_SIZE || collection.length>Number(page.totalRows))fail('mHelpDesk returned an unsupported ticket page.');
        if(Number(page.totalRows)>window.maxTickets)fail('The ticket preview exceeds its maximum count. Use a smaller creation window.');
        if(total!==undefined && page.totalRows!==total)fail('mHelpDesk ticket totals changed during the preview. Retry.');
        total=Number(page.totalRows);
        const rows=collection.map(row=>projectPartnerTicket(row,portalId));
        if(rows.some(row=>Date.parse(row.creationDate)<=Date.parse(window.createdAfter) || Date.parse(row.creationDate)>=Date.parse(window.createdBefore)))fail('mHelpDesk returned tickets outside the requested creation window.');
        if(rows.some((row,i)=>i>0 && Number(row.ticketId)<=Number(rows[i-1].ticketId)))fail('mHelpDesk did not return tickets in stable identity order.');
        return rows;
      };
      let page=pageOf(rawTickets);
      while(true){
        if(tickets.length && (!page.length || Number(page[0].ticketId)<=Number(tickets[tickets.length-1].ticketId)))fail('mHelpDesk returned overlapping or incomplete ticket pages.');
        if(page.some(row=>seen.has(row.ticketId)) || tickets.length+page.length>total!)fail('mHelpDesk returned duplicate ticket identities.');
        for(const row of page){seen.add(row.ticketId);tickets.push(row);}
        if(tickets.length===total)break;
        if(!page.length || page.length!==PAGE_SIZE)fail('mHelpDesk returned an incomplete ticket page.');
        url.searchParams.set('rowIndex',String(tickets.length+indexBase));
        page=pageOf(await read(url.href,'ticket_read'));
        // Generic docs describe one-based later pages, whereas other endpoint defaults are zero.
        // Detect exactly one boundary overlap, then validate ordering, total and completeness.
        if(!boundaryChecked && page.length && page[0].ticketId===tickets[tickets.length-1].ticketId){
          indexBase=1;url.searchParams.set('rowIndex',String(tickets.length+indexBase));page=pageOf(await read(url.href,'ticket_read'));
        }
        boundaryChecked=true;
      }
      const typeIds=new Set(typeRows.map(row=>row.typeId)),statusIds=new Set(statusRows.map(row=>row.statusId));
      return {contract:MHELP_TICKET_CONTRACT,state:'preview_verified' as const,liveAccessVerified:true,automaticSync:false,ticketWrites:false,
        verifiedPortalId:portalId,readAt:new Date().toISOString(),window:{createdAfter:window.createdAfter,createdBefore:window.createdBefore},
        totalRows:total!,previewCount:tickets.length,partial:false,
        ...(evidence===MHELP_OPERATIONAL_EVIDENCE?{operationalEvidence:describeMhelpOperationalEvidence(collectionRows(object(rawTickets))!,total!)}:{}),
        types:typeRows.map(row=>({...row,count:tickets.filter(ticket=>ticket.typeId===row.typeId).length})),
        statuses:statusRows.map(row=>({...row,statusCount:tickets.filter(ticket=>ticket.statusId===row.statusId).length,customStatusCount:tickets.filter(ticket=>ticket.customStatusId===row.statusId).length})),
        metrics:{deletedTickets:tickets.filter(row=>row.deleted).length,assignedTickets:tickets.filter(row=>row.assignmentState==='assigned').length,
          missingAssignmentFields:tickets.filter(row=>row.assignmentState==='unknown').length,
          missingTypeIds:tickets.filter(row=>row.typeId===null).length,unknownTypeIds:tickets.filter(row=>row.typeId!==null&&!typeIds.has(row.typeId)).length,
          unknownStatusIds:tickets.filter(row=>!statusIds.has(row.statusId)).length,unknownCustomStatusIds:tickets.filter(row=>row.customStatusId!==null&&!statusIds.has(row.customStatusId)).length,
          missingCustomerIds:tickets.filter(row=>row.customerId===null).length,missingServiceLocationIds:tickets.filter(row=>row.serviceLocationId===null).length,
          ticketsWithUnknownFields:tickets.filter(row=>row.unknownFieldCount>0).length,unknownFieldOccurrences:tickets.reduce((n,row)=>n+row.unknownFieldCount,0),
          typeLabelMismatches:tickets.filter(row=>row.typeName!==null&&typeRows.some(type=>type.typeId===row.typeId&&type.typeName!==row.typeName)).length,
          duplicateTypeNames:typeRows.length-new Set(typeRows.map(row=>row.typeName)).size}};
    } catch(error) {
      if(error instanceof MhelpTicketError && Object.keys(schema).length)error.schema=schema;
      throw error;
    } finally {clearTimeout(timer);controller.abort();busy=false;}
  }};
}
