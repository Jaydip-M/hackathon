# Full-Text Search Backend

NestJS + PostgreSQL backend with raw SQL (no ORM). Parses and stores multi-page documents, indexes with PostgreSQL full-text search, and exposes create + search APIs.

## Prerequisites

- Node.js 18+
- PostgreSQL (local) with a database e.g. `hackathon_db`

## Setup

1. **Create database** (if needed):

   ```bash
   createdb -U jaydip test
   ```

2. **Run SQL init** (tables, FTS index, and `pg_trgm`). If you had an older schema, drop first then init:

   ```bash
   PGPASSWORD=postgre psql -U jaydip -d test -c "DROP TABLE IF EXISTS document_chunks; DROP TABLE IF EXISTS content; DROP TABLE IF EXISTS documents;"
   PGPASSWORD=postgre psql -U jaydip -d test -f sql/001_init.sql
   ```
   If you already had the schema and only need the fuzzy-search index on titles, run:  
   `CREATE INDEX IF NOT EXISTS idx_chunks_doc_title_trgm ON document_chunks USING GIN (doc_title gin_trgm_ops);`

3. **Environment**:

   ```bash
   cp .env.example .env
   # Edit .env with your PG_USER, PG_PASSWORD, etc.
   ```

4. **Install and run**:

   ```bash
   npm install
   npm run start:dev
   ```

   App runs at `http://localhost:3000`. Set in `.env`: `PG_USER=jaydip`, `PG_PASSWORD=postgre`, `PG_DATABASE=test`.

## API

| Method | Path | Description |
|--------|------|-------------|
| POST | `/documents` | Create document. Body: `{ "title": string, "file_name"?: string, "pages": string[] }`. One row in `document_chunks` per page. |
| POST | `/documents/upload` | Upload a PDF. Multipart form: `file` (PDF), optional `name` (title). Parses each page and stores one chunk per page. |
| GET | `/documents/search?q=...` | Hybrid search: FTS (websearch_to_tsquery, ts_rank_cd) + fuzzy (pg_trgm on doc_title), merged with RRF. Optional: `limit`, `rrf_k`, `fts_weight`, `fuzzy_weight`. Returns `combined_rank` and `rankings` (debug) per hit. |
| GET | `/documents/:id` | Get document metadata and all chunks (by `page_number`). |

## Example

```bash
# Create a document (3 pages) via JSON
curl -X POST http://localhost:3000/documents \
  -H "Content-Type: application/json" \
  -d '{"title":"Annual Report 2024","file_name":"report.pdf","pages":["Page one text.","Page two with keywords.","Page three content."]}'

# Upload a PDF (Postman: Body → form-data, key "file" type File; optional key "name")
curl -X POST http://localhost:3000/documents/upload \
  -F "file=@/path/to/document.pdf" \
  -F "name=My PDF"

# Search (optional: limit, rrf_k, fts_weight, fuzzy_weight)
curl "http://localhost:3000/documents/search?q=keywords"
curl "http://localhost:3000/documents/search?q=keywords&limit=10&fts_weight=0.7&fuzzy_weight=0.3"
```
# hackathon
# hackathon
