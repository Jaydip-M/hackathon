-- Run this entire script directly in your SQL editor (pgAdmin, DBeaver, etc.):
-- 1. Connect to your DB (e.g. test), then copy-paste this whole file and execute.
-- 2. Then run: SELECT * FROM search_documents('your search here');
--
-- Requires: 001_init.sql (pg_trgm, documents, document_chunks with fts_vector).

CREATE OR REPLACE FUNCTION search_documents(
  p_query               TEXT,
  p_match_count         INT   DEFAULT 30,
  p_rrf_k               INT   DEFAULT 60,
  p_fuzzy_title_weight  FLOAT DEFAULT 0.3,
  p_fuzzy_content_weight FLOAT DEFAULT 0.3,
  p_fts_weight          FLOAT DEFAULT 0.4
)
RETURNS TABLE (
  document_id   BIGINT,
  doc_title     TEXT,
  page_number   INT,
  content       TEXT,
  combined_rank FLOAT,
  rankings      JSONB
)
LANGUAGE sql
STABLE
AS $$
  WITH args AS (
    SELECT
      trim(coalesce(p_query, '')) AS q,
      greatest(1, least(coalesce(p_match_count, 30), 100)) AS mc,
      coalesce(p_rrf_k, 60) AS rrf_k,
      coalesce(p_fuzzy_title_weight, 0.3) AS w_ft,
      coalesce(p_fuzzy_content_weight, 0.3) AS w_fc,
      coalesce(p_fts_weight, 0.4) AS w_fts
  ),
  fuzzy_title AS (
    SELECT id, sim_score, rank_ix
    FROM (
      SELECT id, sim_score,
             row_number() OVER (ORDER BY sim_score DESC) AS rank_ix
      FROM (
        SELECT c.id, similarity(c.doc_title, (SELECT q FROM args)) AS sim_score
        FROM document_chunks c, args a
        WHERE a.q != '' AND c.doc_title % a.q
      ) sub
    ) sub2
    CROSS JOIN args a
    WHERE rank_ix <= least(a.mc, 30)
  ),
  fuzzy_content AS (
    SELECT id, sim_score, rank_ix
    FROM (
      SELECT id, sim_score,
             row_number() OVER (ORDER BY sim_score DESC) AS rank_ix
      FROM (
        SELECT c.id, word_similarity((SELECT q FROM args), c.content) AS sim_score
        FROM document_chunks c, args a
        WHERE a.q != '' AND a.q <% c.content
      ) sub
    ) sub2
    CROSS JOIN args a
    WHERE rank_ix <= least(a.mc, 30)
  ),
  fts AS (
    SELECT id, rank_score, rank_ix
    FROM (
      SELECT c.id,
             ts_rank_cd(c.fts_vector, websearch_to_tsquery('english', (SELECT q FROM args))) AS rank_score,
             row_number() OVER (ORDER BY ts_rank_cd(c.fts_vector, websearch_to_tsquery('english', (SELECT q FROM args))) DESC) AS rank_ix
      FROM document_chunks c, args a
      WHERE a.q != '' AND c.fts_vector @@ websearch_to_tsquery('english', a.q)
    ) sub
    CROSS JOIN args a
    WHERE rank_ix <= least(a.mc, 30)
  ),
  merged AS (
    SELECT
      coalesce(ft.id, fc.id, f.id) AS chunk_id,
      ( coalesce(1.0 / ((SELECT rrf_k FROM args) + ft.rank_ix), 0) * (SELECT w_ft FROM args)
        + coalesce(1.0 / ((SELECT rrf_k FROM args) + fc.rank_ix), 0) * (SELECT w_fc FROM args)
        + coalesce(1.0 / ((SELECT rrf_k FROM args) + f.rank_ix), 0) * (SELECT w_fts FROM args)
      ) AS combined_rank,
      json_build_object(
        'fuzzy_title',   json_build_object('rank_ix', ft.rank_ix, 'sim_score', ft.sim_score),
        'fuzzy_content',  json_build_object('rank_ix', fc.rank_ix, 'sim_score', fc.sim_score),
        'fts',           json_build_object('rank_ix', f.rank_ix, 'rank_score', f.rank_score)
      )::jsonb AS rankings
    FROM fuzzy_title ft
    FULL OUTER JOIN fuzzy_content fc ON ft.id = fc.id
    FULL OUTER JOIN fts f ON coalesce(ft.id, fc.id) = f.id
  )
  SELECT
    c.document_id,
    c.doc_title,
    c.page_number,
    c.content,
    m.combined_rank::float,
    m.rankings
  FROM merged m
  JOIN document_chunks c ON c.id = m.chunk_id
  JOIN documents d ON d.id = c.document_id
  CROSS JOIN args a
  WHERE a.q != ''
  ORDER BY m.combined_rank DESC
  LIMIT (SELECT least(mc, 30) FROM args);
$$;
