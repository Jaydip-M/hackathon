export class SearchQueryDto {
  q: string;

  /** Maximum results to return (default 30, max 100) */
  limit?: string;

  /** RRF smoothing constant (default 60) */
  rrf_k?: string;

  /** Weight for pg_trgm similarity() on doc title (default 0.3) */
  fuzzy_title_weight?: string;

  /** Weight for pg_trgm word_similarity() on page content (default 0.3) */
  fuzzy_content_weight?: string;

  /** Weight for full-text search on title tsvector – weight A (default 0.6) */
  fts_title_weight?: string;

  /** Weight for full-text search on body tsvector – weight C, log-normalised (default 0.4) */
  fts_body_weight?: string;
}
