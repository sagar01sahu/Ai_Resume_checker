import path from 'node:path';
import mammoth from 'mammoth';
import { PDFParse } from 'pdf-parse';

export interface ParseResult {
  text: string;
  status: string;
  error?: string;
}

export async function parseDocument(filename: string, buffer: Buffer): Promise<ParseResult> {
  const ext = path.extname(filename).toLowerCase();
  if (!buffer || buffer.length === 0) {
    return { text: '', status: 'Failed: empty file', error: 'Empty file' };
  }

  try {
    if (ext === '.pdf') {
      const parser = new PDFParse({ data: buffer });
      try {
        const result = await parser.getText();
        const cleaned = (result.text || '')
          .replace(/--\s*\d+\s*of\s*\d+\s*--/g, '')
          .trim();
        if (cleaned.length < 30) {
          return {
            text: '',
            status: 'Failed: scanned image',
            error: 'PDF contains no extractable text (likely scanned image).',
          };
        }
        return { text: cleaned, status: 'Parsed' };
      } finally {
        await parser.destroy().catch(() => {});
      }
    }

    if (ext === '.docx') {
      const result = await mammoth.extractRawText({ buffer });
      const cleaned = (result.value || '').trim();
      if (cleaned.length < 20) {
        return {
          text: '',
          status: 'Failed: empty document',
          error: 'DOCX contains no extractable text.',
        };
      }
      return { text: cleaned, status: 'Parsed' };
    }

    if (ext === '.txt') {
      const cleaned = buffer.toString('utf8').trim();
      if (!cleaned) {
        return { text: '', status: 'Failed: empty file', error: 'Empty text file' };
      }
      return { text: cleaned, status: 'Parsed' };
    }

    return {
      text: '',
      status: 'Failed: unsupported format',
      error: `Unsupported extension: ${ext}`,
    };
  } catch (err) {
    const msg = err instanceof Error ? err.message : 'Parse error';
    return { text: '', status: 'Failed: corrupt file', error: msg };
  }
}
