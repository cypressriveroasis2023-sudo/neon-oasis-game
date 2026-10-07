import { isTicketType, type TicketType } from './ticketTypes';
import type { ExtractedTicketField, MhelpExtraction } from './mhelpImportModel';

export type PdfTextPage = { page: number; width: number; height: number; items: { str: string; x: number; y: number; width: number; height: number }[] };
type Line = { page: number; y: number; pieces: PdfTextPage['items']; text: string };
const normalized = (text: string) => text.replace(/[\u2010-\u2015\u2212]/g, '-').replace(/\s+/g, ' ').trim();
const field = (value: string, sourceLabel: string, page = 1): ExtractedTicketField => ({ value: value.trim(), sourceLabel, page });

export function pdfTextLines(pages: PdfTextPage[]): Line[] {
  if (!pages.length || pages.length > 10 || pages.some(page => !Number.isFinite(page.width) || page.width <= 0 || !Number.isFinite(page.height) || page.height <= 0)) throw new Error('The PDF page layout could not be verified.');
  const output: Line[] = [];
  let length = 0;
  for (const page of pages) {
    if (!Array.isArray(page.items) || page.items.length > 20_000) throw new Error('The PDF contains too much text to import safely.');
    const lines: Line[] = [];
    for (const item of page.items.filter(item => item.str.trim()).sort((a,b) => a.y-b.y || a.x-b.x)) {
      if (![item.x,item.y,item.width,item.height].every(Number.isFinite) || item.x < -1 || item.y < -1 || item.x > page.width+1 || item.y > page.height+1) throw new Error('The PDF text positions could not be verified.');
      length += item.str.length;
      if (length > 100_000) throw new Error('The PDF contains too much text to import safely.');
      let line = lines.find(line => Math.abs(line.y-item.y) < 2);
      if (!line) { line = { page:page.page, y:item.y, pieces:[], text:'' }; lines.push(line); }
      line.pieces.push(item);
    }
    for (const line of lines) { line.pieces.sort((a,b) => a.x-b.x); line.text = line.pieces.map(piece => piece.str.trim()).join(' '); }
    output.push(...lines.sort((a,b) => a.y-b.y));
  }
  return output;
}

/** Grounded in the supplied native mHelpDesk Work Order export, never its filename. */
export function extractMhelpWorkOrder(pages: PdfTextPage[], filename: string): MhelpExtraction {
  const lines = pdfTextLines(pages);
  if (!lines.length) throw new Error('This PDF has no readable text. Scanned tickets need review; the original is retained.');
  const headers = lines.map(line => ({ line, match:normalized(line.text).match(/^Work Order No\.\s*(\S+)\s+Issued on\s+(.+)$/i) })).filter(row => row.match);
  if (headers.length !== 1 || headers[0].line.page !== 1) throw new Error('This PDF does not contain one supported mHelpDesk Work Order. The original is retained.');
  const [{ line:header, match }] = headers;
  const sourceId = match![1], issued = match![2];
  const first = lines.filter(line => line.page === 1);
  const unique = (label: string) => {
    const found = first.filter(line => normalized(line.text).startsWith(label));
    if (found.length !== 1) throw new Error('The '+label+' field could not be read unambiguously. Review the original ticket.');
    return found[0];
  };
  const createdLine = unique('Created '), typeLine = unique('Type '), jobLine = unique('Job Name '), descriptionLine = unique('Description ');
  const created = normalized(createdLine.text).match(/^Created\s+(.+?)\s+Priority\s+(.+)$/);
  const type = normalized(typeLine.text).match(/^Type\s+(.+?)\s+Assign\/Appointment(?:\s+(.*))?$/);
  const table = first.find(line => /^Quantity\s+Item Name\s+Notes$/.test(normalized(line.text)));
  if (!created || !type || !table || table.y <= descriptionLine.y || descriptionLine.y <= jobLine.y || header.y >= createdLine.y) throw new Error('The ticket layout differs from the verified Work Order format. Review the original ticket.');
  const forLine = first.find(line => normalized(line.text) === 'for' && line.y < header.y);
  if (!forLine) throw new Error('The customer block could not be verified.');
  const customerBlock = first.filter(line => line.y > forLine.y && line.y < header.y)
    .map(line => line.pieces.filter(piece => piece.x < pages[0].width/2).map(piece => piece.str.trim()).join(' ')).filter(Boolean);
  if (!customerBlock.length) throw new Error('The customer name could not be read.');
  const descriptionPieces = first.filter(line => line.y >= descriptionLine.y && line.y < table.y);
  const description = descriptionPieces.map((line,index) => index === 0 ? line.text.replace(/^Description\s+/,'') : line.text).join('\n');
  const normalizedDescription = normalized(description);
  const address = description.match(/^Address:\s*([^\n]+)/i)?.[1];
  const contactMatch = description.match(/\bSite contacts?:\s*([\s\S]+)/i)?.[1];
  const monitoring = description.match(/\bMonitoring times are:\s*([\s\S]+?)(?=\bSite contacts?:|$)/i)?.[1];
  const notesCell = table.pieces.find(piece => piece.str.trim() === 'Notes');
  if (!notesCell) throw new Error('The line-item columns could not be verified.');
  const lineItems: NonNullable<MhelpExtraction['lineItems']> = [];
  for (const line of first.filter(line => line.y > table.y && !/^Added by:/i.test(line.text))) {
    const left = line.pieces.filter(piece => piece.x < notesCell.x-2).map(piece => piece.str.trim()).join(' ');
    const right = line.pieces.filter(piece => piece.x >= notesCell.x-2).map(piece => piece.str.trim()).join(' ');
    const start = left.match(/^(\d+(?:\.\d+)?|\d+hr\s+\d+min)\s+(.+)$/);
    if (start) lineItems.push({ quantity:start[1], itemName:start[2], notes:right, page:1 });
    else if (lineItems.length && (left || right)) {
      const current = lineItems[lineItems.length-1];
      if (left) current.itemName += ' '+left;
      if (right) current.notes += (current.notes?' ':'')+right;
    } else if (left || right) throw new Error('A line item could not be read unambiguously. Review the original ticket.');
  }
  if (!lineItems.length) throw new Error('No line items could be read from this Work Order.');
  const warnings = [
    'Confirm the actual COS customer and site. Printed names and addresses do not establish an association.',
    'No physical unit identifier is mapped by this export parser. Equipment descriptions and camera counts are not unit numbers.',
    'No delivery appointment is mapped. Created/issued dates and monitoring hours are not a delivery schedule.',
    'Review every line item and remaining source text before saving. No billing, monitoring, call-list or technician assignment is changed by import.',
  ];
  const fileHint = filename.match(/^Ticket(\d+)(?:_|\.)/i)?.[1];
  if (fileHint && fileHint !== sourceId) warnings.unshift('The filename contains a different number. Use the printed Work Order No. and retain the original filename separately.');
  if (type[2]) warnings.push('Assign/Appointment contains source text only; confirm any COS technician or appointment separately.');
  if (!address) warnings.push('The description has no separately recognized service-site address.');
  const customerPhone = customerBlock.slice(1).find(value => /^[+()\d\s.\-]{7,}$/.test(normalized(value)));
  const extra: ExtractedTicketField[] = [
    field(issued, 'Issued on'), field(created[1], 'Created'), field(created[2], 'Priority (original)'),
    field(unique('Status ').text.replace(/^Status\s+/,''),'Status'), field(type[2] || '', 'Assign/Appointment'),
    field(customerBlock.slice(1).filter(value => value !== customerPhone).join('\n'),'Customer mailing address'),
  ];
  if (customerPhone) extra.push(field(customerPhone,'Customer office phone'));
  if (monitoring) extra.push(field(monitoring,'Monitoring instructions'));
  // Keep all continuation-page content; the supplied two-page export has an Added by note.
  for (const page of pages.filter(page => page.page > 1)) {
    const text = lines.filter(line => line.page === page.page).map(line => line.text).join('\n');
    if (text) extra.push(field(text, 'Continuation page', page.page));
  }
  if (/\bdo not\b/i.test(normalizedDescription)) warnings.push('The source contains an explicit restriction. Preserve it with the work/contact instructions and review it.');
  const title = jobLine.text.replace(/^Job Name\s+/, '');
  return {
    sourceTicketId:field(sourceId,'Work Order No.'), title:field(title,'Job Name'), site:field(title,'Job Name'),
    customer:field(customerBlock[0],'Work Order for'), description:field(description,'Description'),
    address:address ? field(address,'Description → Address') : undefined,
    contact:contactMatch ? field(contactMatch,'Description → Site contacts') : undefined,
    jobType:field(type[1],'Type'), priority:field(created[2],'Priority'), units:[], additionalFields:extra, lineItems,
    documentText:pages.map(page => 'Page '+page.page+'\n'+lines.filter(line => line.page === page.page).map(line => line.text).join('\n')).join('\n\n'), warnings,
  };
}

/** Suggestions only; neither source staff names nor dates become assignments. */
export function suggestWorkOrderDefaults(extraction: MhelpExtraction): { jobType?: TicketType; priority?: 'normal' | 'high' | 'urgent' } {
  const type = normalized(extraction.jobType?.value || '').replace(/^\*|\*$/g,'').toUpperCase();
  const priority = normalized(extraction.priority?.value || '').toLowerCase();
  return { jobType:isTicketType(type) ? type : undefined,
    priority:priority === 'standard' || priority === 'normal' ? 'normal' : priority === 'high' ? 'high' : priority === 'urgent' ? 'urgent' : undefined };
}

/** Avoid conflicting duplicate contact edits; immutable parserData keeps the full source. */
export function workInstructionsForReview(extraction: MhelpExtraction): string {
  let text=extraction.description?.value||'';
  if(extraction.additionalFields.some(field=>field.sourceLabel==='Monitoring instructions')) text=text.replace(/\bMonitoring times are:\s*[\s\S]+?(?=\bSite contacts?:|$)/i,'');
  if(extraction.contact) text=text.replace(/\bSite contacts?:\s*[\s\S]+$/i,'');
  return text.trim();
}
