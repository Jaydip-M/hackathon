import { Injectable, NotFoundException } from "@nestjs/common";
import { DatabaseService } from "../database/database.service";

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
  /** Fuzzy match on document title via pg_trgm similarity() */
  fuzzy_title?: { rank_ix: number | null; sim_score: number | null };
  /** Fuzzy match on page content via pg_trgm word_similarity() */
  fuzzy_content?: { rank_ix: number | null; sim_score: number | null };
  /** Full-text search on title tsvector (weight A = 1.0) */
  fts_title?: { rank_ix: number | null; rank_score: number | null };
  /** Full-text search on content tsvector (weight C = 0.2, log-length normalised) */
  fts_body?: { rank_ix: number | null; rank_score: number | null };
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
    if (!doc) throw new Error("Insert document failed");

    for (let pageNum = 1; pageNum <= pages.length; pageNum++) {
      await this.db.query(
        `INSERT INTO document_chunks (document_id, doc_title, page_number, content)
         VALUES ($1, $2, $3, $4)`,
        [doc.id, doc.title, pageNum, pages[pageNum - 1] ?? ""],
      );
    }

    return doc;
  }

  async search(
    query: string,
    opts: {
      match_count?: number;
      rrf_k?: number;
      /** RRF weight for title fuzzy (pg_trgm similarity). Default 0.3 */
      fuzzy_title_weight?: number;
      /** RRF weight for content fuzzy (pg_trgm word_similarity). Default 0.3 */
      fuzzy_content_weight?: number;
      /** RRF weight for title FTS (weight-A tsvector). Default 0.6 */
      fts_title_weight?: number;
      /** RRF weight for body FTS (weight-C tsvector, log-length normalised). Default 0.4 */
      fts_body_weight?: number;
    } = {},
  ): Promise<SearchResultRow[]> {
    const q = (query ?? "").trim();
    if (!q) return [];

    const match_count = Math.min(Math.max(1, opts.match_count ?? 30), 100);
    const rrf_k = opts.rrf_k ?? 60;
    const fuzzy_title_weight = opts.fuzzy_title_weight ?? 0.3;
    const fuzzy_content_weight = opts.fuzzy_content_weight ?? 0.3;
    const fts_title_weight = opts.fts_title_weight ?? 0.6;
    const fts_body_weight = opts.fts_body_weight ?? 0.4;

    // Parameters: $1=query  $2=match_count  $3=rrf_k
    //             $4=fuzzy_title_weight  $5=fuzzy_content_weight
    //             $6=fts_title_weight    $7=fts_body_weight
    const result = await this.db.query<SearchResultRow>(
      `WITH
       -- ── 1. Fuzzy on doc_title using similarity() ──────────────────────────
       fuzzy_title AS (
         SELECT id,
                similarity(doc_title, $1)                                         AS sim_score,
                row_number() OVER (ORDER BY similarity(doc_title, $1) DESC)       AS rank_ix
         FROM   document_chunks
         WHERE  doc_title % $1
         ORDER BY rank_ix
         LIMIT  LEAST($2::int, 30)
       ),

       -- ── 2. Fuzzy on page content using word_similarity() ──────────────────
       --      word_similarity($1, content) measures how well the short query
       --      matches as a contiguous word sequence inside the longer content.
       fuzzy_content AS (
         SELECT id,
                word_similarity($1, content)                                          AS sim_score,
                row_number() OVER (ORDER BY word_similarity($1, content) DESC)        AS rank_ix
         FROM   document_chunks
         WHERE  $1 <% content
         ORDER BY rank_ix
         LIMIT  LEAST($2::int, 30)
       ),

       -- ── 3. Full-text search on title vector (weight A = 1.0) ──────────────
       fts_title AS (
         SELECT id,
                ts_rank_cd(fts_title, websearch_to_tsquery('english', $1))                            AS rank_score,
                row_number() OVER (ORDER BY ts_rank_cd(fts_title, websearch_to_tsquery('english', $1)) DESC) AS rank_ix
         FROM   document_chunks
         WHERE  fts_title @@ websearch_to_tsquery('english', $1)
         ORDER BY rank_ix
         LIMIT  LEAST($2::int, 30)
       ),

       -- ── 4. Full-text search on content vector (weight C = 0.2)  ──────────
       --      Normalisation flag 1 = divide by 1 + log(doc length) to reduce
       --      the advantage of very long pages.
       fts_body AS (
         SELECT id,
                ts_rank_cd(fts_content, websearch_to_tsquery('english', $1), 1)                            AS rank_score,
                row_number() OVER (ORDER BY ts_rank_cd(fts_content, websearch_to_tsquery('english', $1), 1) DESC) AS rank_ix
         FROM   document_chunks
         WHERE  fts_content @@ websearch_to_tsquery('english', $1)
         ORDER BY rank_ix
         LIMIT  LEAST($2::int, 30)
       )

       -- ── Final: Reciprocal Rank Fusion across all four lanes ───────────────
       SELECT
         c.document_id,
         c.doc_title,
         c.page_number,
         c.content,
         (
           COALESCE(1.0 / ($3 + ft.rank_ix),  0.0) * $4 +
           COALESCE(1.0 / ($3 + fc.rank_ix),  0.0) * $5 +
           COALESCE(1.0 / ($3 + fst.rank_ix), 0.0) * $6 +
           COALESCE(1.0 / ($3 + fsb.rank_ix), 0.0) * $7
         )::float AS combined_rank,
         json_build_object(
           'fuzzy_title',   json_build_object('rank_ix', ft.rank_ix,  'sim_score',  ft.sim_score),
           'fuzzy_content', json_build_object('rank_ix', fc.rank_ix,  'sim_score',  fc.sim_score),
           'fts_title',     json_build_object('rank_ix', fst.rank_ix, 'rank_score', fst.rank_score),
           'fts_body',      json_build_object('rank_ix', fsb.rank_ix, 'rank_score', fsb.rank_score)
         ) AS rankings
       FROM       fuzzy_title    ft
       FULL OUTER JOIN fuzzy_content  fc  ON ft.id = fc.id
       FULL OUTER JOIN fts_title      fst ON COALESCE(ft.id, fc.id) = fst.id
       FULL OUTER JOIN fts_body       fsb ON COALESCE(ft.id, fc.id, fst.id) = fsb.id
       JOIN document_chunks           c   ON c.id = COALESCE(ft.id, fc.id, fst.id, fsb.id)
       JOIN documents                 d   ON d.id = c.document_id
       ORDER BY combined_rank DESC
       LIMIT LEAST($2::int, 30)`,
      [
        q,
        match_count,
        rrf_k,
        fuzzy_title_weight,
        fuzzy_content_weight,
        fts_title_weight,
        fts_body_weight,
      ],
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
    if (!document) throw new NotFoundException("Document not found");

    const chunksResult = await this.db.query<ChunkRow>(
      `SELECT id, document_id, doc_title, page_number, content, created_at
       FROM document_chunks WHERE document_id = $1 ORDER BY page_number`,
      [id],
    );

    return { document, chunks: chunksResult.rows };
  }
}
