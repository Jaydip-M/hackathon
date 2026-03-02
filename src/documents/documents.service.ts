import { Injectable, NotFoundException } from '@nestjs/common';
import { DatabaseService } from '../database/database.service';

export interface DocumentRow {
  id: number;
  title: string;
  file_name: string;
  total_pages: number | null;
  created_at: Date;
}

export interface ChunkRow {
  id: number;
  document_id: number;
  doc_title: string;
  page_number: number;
  content: string;
  created_at: Date;
}

export interface SearchResultRow {
  document_id: number;
  doc_title: string;
  page_number: number;
  content: string;
  rank: number;
}

@Injectable()
export class DocumentsService {
  constructor(private readonly db: DatabaseService) {}

  /** Schema: documents(id, title, file_name, total_pages, created_at) — no "name" column */
  async create(
    title: string,
    file_name: string,
    pages: string[],
  ): Promise<DocumentRow> {
    const total_pages = pages.length;
    const insertDoc = await this.db.query<DocumentRow>(
      `INSERT INTO documents (title, file_name, total_pages)
       VALUES ($1, $2, $3)
       RETURNING id, title, file_name, total_pages, created_at`,
      [title, file_name, total_pages],
    );
    const doc = insertDoc.rows[0];
    if (!doc) throw new Error('Insert document failed');

    for (let pageNum = 1; pageNum <= pages.length; pageNum++) {
      await this.db.query(
        `INSERT INTO document_chunks (document_id, doc_title, page_number, content)
         VALUES ($1, $2, $3, $4)`,
        [doc.id, doc.title, pageNum, pages[pageNum - 1] ?? ''],
      );
    }

    return doc;
  }

  async search(query: string): Promise<SearchResultRow[]> {
    const q = (query ?? '').trim();
    if (!q) return [];

    const result = await this.db.query<SearchResultRow>(
      `SELECT c.document_id, c.doc_title, c.page_number, c.content,
              ts_rank(c.fts_vector, plainto_tsquery('english', $1)) AS rank
       FROM document_chunks c
       JOIN documents d ON d.id = c.document_id
       WHERE c.fts_vector @@ plainto_tsquery('english', $1)
       ORDER BY rank DESC`,
      [q],
    );
    return result.rows;
  }

  async findOne(
    id: string,
  ): Promise<{ document: DocumentRow; chunks: ChunkRow[] }> {
    const docResult = await this.db.query<DocumentRow>(
      `SELECT id, title, file_name, total_pages, created_at
       FROM documents WHERE id = $1`,
      [id],
    );
    const document = docResult.rows[0];
    if (!document) throw new NotFoundException('Document not found');

    const chunksResult = await this.db.query<ChunkRow>(
      `SELECT id, document_id, doc_title, page_number, content, created_at
       FROM document_chunks WHERE document_id = $1 ORDER BY page_number`,
      [id],
    );

    return { document, chunks: chunksResult.rows };
  }
}
