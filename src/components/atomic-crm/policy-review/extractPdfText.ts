export interface PdfExtractionResult {
  text: string;
  pageCount: number;
  /** True when almost no text was recovered — likely a scanned (image-only) PDF. */
  likelyScanned: boolean;
}

/**
 * Extract the text layer from a PDF file in the browser. unpdf bundles a
 * serverless build of pdf.js, so this needs no worker configuration.
 *
 * Scanned PDFs have no text layer; `likelyScanned` flags that case so the
 * caller can tell the user OCR is required (not yet supported).
 */
export async function extractPdfText(file: File): Promise<PdfExtractionResult> {
  // Loaded on demand — unpdf bundles pdf.js (~1.6MB), kept out of the main bundle.
  const { extractText, getDocumentProxy } = await import("unpdf");
  const buffer = await file.arrayBuffer();
  const pdf = await getDocumentProxy(new Uint8Array(buffer));
  const { totalPages, text } = await extractText(pdf, { mergePages: true });
  const merged = text.trim();
  return {
    text: merged,
    pageCount: totalPages,
    likelyScanned: merged.length < 25 * totalPages,
  };
}
