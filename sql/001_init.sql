-- Full-text search backend: documents + document_chunks (with FTS and pg_trgm)
-- Run once: psql -U postgres -d hackathon_db -f sql/001_init.sql

CREATE EXTENSION IF NOT EXISTS pg_trgm;

-- One row per PDF
CREATE TABLE documents (
    id           BIGINT PRIMARY KEY GENERATED ALWAYS AS IDENTITY,
    title        TEXT NOT NULL,
    file_name    TEXT NOT NULL,
    total_pages  INT,
    created_at   TIMESTAMPTZ DEFAULT now()
);

-- One row per page
CREATE TABLE document_chunks (
    id           BIGINT PRIMARY KEY GENERATED ALWAYS AS IDENTITY,
    document_id  BIGINT NOT NULL REFERENCES documents(id) ON DELETE CASCADE,
    doc_title    TEXT NOT NULL,
    page_number  INT NOT NULL,
    content      TEXT NOT NULL,

    fts_vector   tsvector GENERATED ALWAYS AS (
        setweight(to_tsvector('english', coalesce(doc_title, '')), 'A') ||
        setweight(to_tsvector('english', coalesce(content,   '')), 'C')
    ) STORED,

    created_at   TIMESTAMPTZ DEFAULT now()
);

-- Indexes
CREATE INDEX idx_chunks_fts    ON document_chunks USING GIN (fts_vector);
CREATE INDEX idx_chunks_trgm   ON document_chunks USING GIN (content gin_trgm_ops);
CREATE INDEX idx_chunks_doc_title_trgm ON document_chunks USING GIN (doc_title gin_trgm_ops);
CREATE INDEX idx_chunks_doc_id ON document_chunks (document_id);

-- BM25 (optional: requires ParadeDB extension; comment out if not installed)
-- CALL paradedb.create_bm25(
--     index_name  => 'chunks_bm25',
--     table_name  => 'document_chunks',
--     id_field    => 'id',
--     text_fields => paradedb.field('content') || paradedb.field('doc_title')
-- );
