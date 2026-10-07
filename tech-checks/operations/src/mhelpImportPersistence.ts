import { importTicketFingerprint, validateReviewedImport, type ImportDirectory, type ImportSource, type ReviewedImportTicket } from './mhelpImportModel';

export type StagedTicketAttachment = {
  id: string;
  organizationId: string;
  sha256: string;
  byteLength: number;
  state: 'staged' | 'trash';
  recoverable: true;
  attemptId?: string;
  jobId?: string;
  disposition?: 'created' | 'duplicate' | null;
  source?: ImportSource;
};
export type SavedImport = {
  jobId: string;
  organizationId: string;
  attachmentId: string;
  status: 'saved';
  ticket: ReviewedImportTicket;
};
/**
 * No production adapter exists yet. Its backend must authorize the current owner,
 * verify staged bytes, and atomically deduplicate source ID/hash within the org.
 * The adapter must never call the owner-manual endpoint or permanently delete.
 */
export type MhelpImportAdapter = {
  commit(request: { organizationId: string; attachmentId: string; ticket: ReviewedImportTicket }): Promise<{ jobId: string; disposition: 'created' | 'duplicate' }>;
  readJob(jobId: string): Promise<SavedImport | null>;
  moveToRecoverableTrash(attachmentId: string, verifiedJobId: string, ticket: ReviewedImportTicket): Promise<void>;
  readAttachment(attachmentId: string): Promise<StagedTicketAttachment | null>;
};
export type ImportSaveResult =
  | { status: 'busy' | 'review_required' }
  | { status: 'duplicate'; jobId: string }
  | { status: 'unconfirmed'; message: string }
  | { status: 'saved_file_retained' | 'saved_and_trashed'; jobId: string; message: string };

/** One explicit commit; independent full readback; only then a recoverable trash move. */
export function createMhelpImportSaver(adapter: MhelpImportAdapter) {
  let running = false;
  let attempted = false;
  return {
    get busy() { return running; },
    get needsReview() { return attempted; },
    async save(request: { organizationId: string; attachment: StagedTicketAttachment; ticket: ReviewedImportTicket; directory: ImportDirectory }): Promise<ImportSaveResult> {
      if (running) return { status: 'busy' };
      if (attempted) return { status: 'review_required' };
      validateReviewedImport(request.ticket, request.directory);
      const { attachment, organizationId } = request;
      if (!organizationId || !attachment.id || attachment.organizationId !== organizationId || attachment.state !== 'staged' || attachment.recoverable !== true ||
          attachment.sha256 !== request.ticket.source.sha256 || attachment.byteLength !== request.ticket.source.byteLength) throw new Error('The staged original attachment could not be verified.');
      // Snapshot before the first await: editing a draft cannot change an in-flight save.
      const ticket = structuredClone(request.ticket);
      const attachmentId = attachment.id;
      const expected = importTicketFingerprint(ticket);
      running = true;
      attempted = true;
      let jobId: string;
      try {
        try {
          const response = await adapter.commit({ organizationId, attachmentId, ticket });
          if (!response || typeof response.jobId !== 'string' || !response.jobId || !['created', 'duplicate'].includes(response.disposition)) throw new Error('Incomplete import response.');
          jobId = response.jobId;
          if (response.disposition === 'duplicate') return { status: 'duplicate', jobId };
          const saved = await adapter.readJob(jobId);
          if (!saved || saved.jobId !== jobId || saved.organizationId !== organizationId || saved.attachmentId !== attachmentId ||
              saved.status !== 'saved' || importTicketFingerprint(saved.ticket) !== expected) throw new Error('Full saved ticket readback did not match.');
        } catch {
          return { status: 'unconfirmed', message: 'The complete saved ticket could not be verified. The original attachment is retained. Review import history before any retry.' };
        }
        try {
          await adapter.moveToRecoverableTrash(attachmentId, jobId, ticket);
          const stored = await adapter.readAttachment(attachmentId);
          if (!stored || stored.id !== attachmentId || stored.organizationId !== organizationId || stored.sha256 !== ticket.source.sha256 ||
              stored.byteLength !== ticket.source.byteLength || stored.state !== 'trash' || stored.recoverable !== true) throw new Error('Recoverable trash readback did not match.');
          return { status: 'saved_and_trashed', jobId, message: 'The ticket was saved and verified. The imported copy is in recoverable app trash.' };
        } catch {
          return { status: 'saved_file_retained', jobId, message: 'The ticket was saved and verified. The attachment trash move could not be confirmed; review the original in imports or recoverable app trash.' };
        }
      } finally { running = false; }
    },
  };
}
