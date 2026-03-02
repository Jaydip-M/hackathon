# York IE Internal Hackathon – Criteria vs Implementation

Use this to ensure the project and presentation match the hackathon problem.

---

## Problem statement (criteria)

| # | Criterion | Required |
|---|-----------|----------|
| 1 | **Full-text search engine** | Yes |
| 2 | **Operations**: (1) parse, (2) store, (3) index, rank, and retrieve | Yes |
| 3 | Use **Postgres extension(s)** where helpful | Yes |
| 4 | **Backend**: Node + NestJS + Postgres, **local** connection | Yes |
| 5 | **No ORM** – write clear SQL queries | Yes |
| 6 | **Database**: table `documents` (id, name); table content with `document_id`, content/description | Yes (schema evolved: see below) |
| 7 | **One row per page**: if document has 10 pages → 10 rows in content | Yes |
| 8 | **API to parse document and save** | Yes |
| 9 | **PDF from Postman**: handle parsing and saving content per page in a single row each | Yes |
| 10 | **Backend only**, connect to local DB | Yes |

---

## How this project meets each criterion

### 1. Full-text search engine

- **FTS**: PostgreSQL `tsvector` / `tsquery` with GIN index on `document_chunks.fts_vector` (title weight A, content weight C).
- **Fuzzy search**: `pg_trgm` on `doc_title` and `content` for typo-tolerant search.
- **Ranking**: `ts_rank_cd`, RRF (Reciprocal Rank Fusion) combining FTS + fuzzy, optional weights and debug rankings.

### 2. Operations: parse, store, index, rank, retrieve

| Operation | Where implemented |
|-----------|-------------------|
| **Parse** | PDF upload → `PdfParserService` (per-page text); JSON create → `pages[]` in body. |
| **Store** | `POST /documents` and `POST /documents/upload` → insert into `documents` and `document_chunks` (one row per page). |
| **Index** | `fts_vector` generated column; GIN indexes on `fts_vector`, `content` (trgm), `doc_title` (trgm). |
| **Rank** | `ts_rank_cd`, RRF with configurable `rrf_k`, `fts_weight`, `fuzzy_weight`; `combined_rank` and `rankings` in response. |
| **Retrieve** | `GET /documents/search?q=...` returns matching chunks with ranking; `GET /documents/:id` returns document + all chunks. |

### 3. Postgres extensions

- **pg_trgm**: enabled in `sql/001_init.sql`; used for fuzzy/similarity search on `doc_title` and `content`.
- **Built-in FTS**: `to_tsvector`, `websearch_to_tsquery`, GIN index on `fts_vector`.

### 4. Backend: Node + NestJS + Postgres, local connection

- NestJS app (Node); `pg` for Postgres; connection via env (`PG_HOST`, `PG_PORT`, `PG_USER`, `PG_PASSWORD`, `PG_DATABASE`) for local DB (e.g. `test` with user `jaydip`).

### 5. No ORM – clear SQL

- All DB access in `DatabaseService.query()` with raw SQL strings and parameters (e.g. `$1`, `$2`). No TypeORM/Prisma.

### 6. Database schema

- **documents**: `id` (BIGINT IDENTITY), `title`, `file_name`, `total_pages`, `created_at`. (Original problem said “name”; implemented as `title` + `file_name` per later spec.)
- **document_chunks** (content): `id`, `document_id` (BIGINT FK to documents), `doc_title`, `page_number`, `content`, `fts_vector` (generated), `created_at`. One row per page.

### 7. One row per page

- Each page of a PDF or each element of `pages[]` in JSON creates exactly one row in `document_chunks` with `page_number` 1, 2, … N.

### 8. API to parse document and save

- **POST /documents**: JSON body `{ "title", "file_name?", "pages": [] }` → parse (pages) and save.
- **POST /documents/upload**: multipart PDF → parse (per-page text) and save.

### 9. PDF from Postman

- Upload PDF in Postman: Body → form-data, key `file` (type File), optional `name` (title). Server parses PDF per page and saves one row per page in `document_chunks`.

### 10. Backend only, local DB

- No frontend; only NestJS backend. Connects to local PostgreSQL (e.g. `PG_DATABASE=test`).

---

## Suggested slides for the presentation

1. **Problem** – Full-text search engine: parse, store, index, rank, retrieve; Node + NestJS + Postgres; no ORM; PDF + JSON input.
2. **Architecture** – NestJS + `pg`, raw SQL; tables `documents` and `document_chunks`; one row per page.
3. **Parse & store** – PDF upload and JSON create APIs; per-page parsing and inserts.
4. **Index & search** – FTS (`tsvector`/GIN) + fuzzy (`pg_trgm`); RRF ranking; optional BM25 (ParadeDB) noted in SQL.
5. **APIs** – `POST /documents`, `POST /documents/upload`, `GET /documents/search?q=...`, `GET /documents/:id`.
6. **Demo** – Postman: upload PDF, then search; show response with `combined_rank` and `rankings`.

---

## Quick verification commands

```bash
# Create doc via JSON
curl -X POST http://localhost:3000/documents -H "Content-Type: application/json" \
  -d '{"title":"Test","file_name":"test.pdf","pages":["Page 1 text","Page 2 text"]}'

# Search
curl "http://localhost:3000/documents/search?q=text&limit=5"
```

Use this file to align the PowerPoint content and to double-check that the project meets all stated hackathon criteria.
