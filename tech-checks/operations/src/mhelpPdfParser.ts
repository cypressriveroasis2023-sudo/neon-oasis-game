import workerUrl from 'pdfjs-dist/legacy/build/pdf.worker.min.mjs?url';
import { MHELP_IMPORT_MAX_BYTES, type MhelpParser } from './mhelpImportModel';
import { extractMhelpWorkOrder, type PdfTextPage } from './mhelpWorkOrderPdf';

/** Text extraction stays in this browser; no file is sent to an OCR/AI service. */
export const mhelpWorkOrderPdfParser: MhelpParser = {
  id:'mhelpdesk-work-order-text-pdf', version:'1', extensions:['.pdf'], mimeTypes:['application/pdf'],
  async parse(file, signal) {
    if (signal.aborted) throw new DOMException('Reading cancelled.','AbortError');
    if (file.size <= 0 || file.size > MHELP_IMPORT_MAX_BYTES) throw new Error('Choose a nonempty PDF under 10 MiB.');
    const data = new Uint8Array(await file.arrayBuffer());
    if (new TextDecoder('ascii').decode(data.slice(0,5)) !== '%PDF-') throw new Error('The file is not a readable PDF. The original is retained.');
    const pdfjs = await import('pdfjs-dist/legacy/build/pdf.mjs');
    if (signal.aborted) throw new DOMException('Reading cancelled.','AbortError');
    pdfjs.GlobalWorkerOptions.workerSrc = workerUrl;
    // We read text only. No viewer/actions, external document URL, fonts, OCR,
    // image rendering or XFA execution is involved in the import.
    const loading = pdfjs.getDocument({ data, useWorkerFetch:false, useWasm:false, useSystemFonts:false,
      disableFontFace:true, enableXfa:false, stopAtErrors:true, disableAutoFetch:true, disableStream:true });
    let timedOut = false;
    const cancel = () => { void loading.destroy().catch(() => undefined); };
    const timeout = setTimeout(() => { timedOut = true; cancel(); }, 15_000);
    signal.addEventListener('abort',cancel,{once:true});
    try {
      const document = await loading.promise;
      if (document.numPages > 10) throw new Error('This PDF exceeds the 10-page ticket import limit.');
      const pages: PdfTextPage[] = [];
      for (let n = 1; n <= document.numPages; n++) {
        if (signal.aborted || timedOut) throw new Error('PDF reading was interrupted.');
        const page = await document.getPage(n);
        const content = await page.getTextContent();
        pages.push({page:n,width:page.view[2]-page.view[0],height:page.view[3]-page.view[1],
          items:content.items.filter(item => 'str' in item).map(item => ({str:item.str,x:item.transform[4]-page.view[0],y:page.view[3]-item.transform[5],width:item.width,height:item.height}))});
      }
      if (signal.aborted || timedOut) throw new Error('PDF reading was interrupted.');
      return extractMhelpWorkOrder(pages,file.name);
    } catch (cause) {
      if (signal.aborted) throw new DOMException('Reading cancelled.','AbortError');
      if (timedOut) throw new Error('PDF reading timed out. The original is retained.');
      if (cause instanceof Error && cause.name === 'PasswordException') throw new Error('Password-protected PDFs require manual review. The original is retained.');
      throw cause;
    } finally {
      clearTimeout(timeout); signal.removeEventListener('abort',cancel);
      await loading.destroy().catch(() => undefined);
    }
  },
};

export const sampleVerifiedMhelpParsers: readonly MhelpParser[] = [mhelpWorkOrderPdfParser];
