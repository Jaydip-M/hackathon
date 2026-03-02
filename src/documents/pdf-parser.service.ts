import { Injectable } from '@nestjs/common';

const pdfjsLib = require('pdfjs-dist/legacy/build/pdf.js') as {
  getDocument: (params: { data: Uint8Array }) => { promise: Promise<PDFDocumentProxy> };
};
interface PDFDocumentProxy {
  numPages: number;
  getPage: (n: number) => Promise<PDFPageProxy>;
}
interface PDFPageProxy {
  getTextContent: () => Promise<TextContent>;
}

export interface TextItem {
  str: string;
}

export interface TextContent {
  items: TextItem[];
}

/**
 * Extracts text from each page of a PDF buffer.
 * Returns one string per page (empty string if page has no text).
 */
@Injectable()
export class PdfParserService {
  async extractTextPerPage(buffer: Buffer): Promise<string[]> {
    const data = new Uint8Array(buffer);
    const loadingTask = pdfjsLib.getDocument({ data });
    const doc = await loadingTask.promise;
    const numPages = doc.numPages;
    const pages: string[] = [];

    for (let i = 1; i <= numPages; i++) {
      const page = await doc.getPage(i);
      const content: TextContent = await page.getTextContent();
      const text = (content.items as TextItem[])
        .map((item) => item.str)
        .join(' ');
      pages.push(text);
    }

    return pages;
  }
}
