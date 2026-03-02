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

export interface SearchRankings {
  fuzzy?: { rank_ix: number | null; sim_score: number | null };
  fts?: { rank_ix: number | null; rank_score: number | null };
}

export interface SearchResultRow {
  document_id: number;
  doc_title: string;
  page_number: number;
  content: string;
  combined_rank: number;
  rankings: SearchRankings;
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

  async search(
    query: string,
    opts: {
      match_count?: number;
      rrf_k?: number;
      fts_weight?: number;
      fuzzy_weight?: number;
    } = {},
  ): Promise<SearchResultRow[]> {
    const q = (query ?? '').trim();
    if (!q) return [];

    const match_count = Math.min(Math.max(1, opts.match_count ?? 30), 100);
    const rrf_k = opts.rrf_k ?? 60;
    const fts_weight = opts.fts_weight ?? 0.5;
    const fuzzy_weight = opts.fuzzy_weight ?? 0.5;

    const result = await this.db.query<SearchResultRow>(
      `WITH fts AS (
         SELECT id, rank_score, rank_ix FROM (
           SELECT c.id,
                  ts_rank_cd(c.fts_vector, websearch_to_tsquery('english', $1)) AS rank_score,
                  row_number() OVER (ORDER BY ts_rank_cd(c.fts_vector, websearch_to_tsquery('english', $1)) DESC) AS rank_ix
           FROM document_chunks c
           WHERE c.fts_vector @@ websearch_to_tsquery('english', $1)
         ) sub
         WHERE rank_ix <= LEAST($2, 30)
       ),
       fuzzy AS (
         SELECT id, sim_score, rank_ix FROM (
           SELECT c.id,
                  similarity(c.doc_title, $1) AS sim_score,
                  row_number() OVER (ORDER BY similarity(c.doc_title, $1) DESC) AS rank_ix
           FROM document_chunks c
           WHERE c.doc_title % $1
         ) sub
         WHERE rank_ix <= LEAST($2, 30)
       ),
       merged AS (
         SELECT
           COALESCE(fuzzy.id, fts.id) AS chunk_id,
           (COALESCE(1.0 / ($3 + fts.rank_ix), 0) * $4 + COALESCE(1.0 / ($3 + fuzzy.rank_ix), 0) * $5) AS combined_rank,
           json_build_object(
             'fuzzy', json_build_object('rank_ix', fuzzy.rank_ix, 'sim_score', fuzzy.sim_score),
             'fts', json_build_object('rank_ix', fts.rank_ix, 'rank_score', fts.rank_score)
           ) AS rankings
         FROM fuzzy
         FULL OUTER JOIN fts ON fuzzy.id = fts.id
       )
       SELECT c.document_id, c.doc_title, c.page_number, c.content,
              m.combined_rank::float AS combined_rank,
              m.rankings
       FROM merged m
       JOIN document_chunks c ON c.id = m.chunk_id
       JOIN documents d ON d.id = c.document_id
       ORDER BY m.combined_rank DESC
       LIMIT LEAST($2, 30)`,
      [q, match_count, rrf_k, fts_weight, fuzzy_weight],
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
