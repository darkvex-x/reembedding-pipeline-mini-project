# Re-embedding Pipeline Mini Project

This repository implements a zero-downtime embedding model upgrade from `text-embedding-ada-002` to `text-embedding-3-small` in PostgreSQL with `pgvector`, featuring dual vector columns, batch checkpoints in `job_progress`, and cost estimation logging in `embedding_costs`.

---

## 1. Test Output (`npm test`)

```text
✔ read checkpoint returns 0 when no row exists, or last_id when present (1.6435ms)
✔ fetch batch queries id > lastId, embedding_v2 IS NULL, ordered by id with limit 50 (0.3494ms)
✔ search route selects embedding_v2 for v2 and embedding for v1 (0.2335ms)
✔ cost logger calculates tokens and cost, and ignores db error (1.206ms)
ℹ tests 4
ℹ suites 0
ℹ pass 4
ℹ fail 0
ℹ cancelled 0
ℹ skipped 0
ℹ todo 0
ℹ duration_ms 807.4277
```

> **Verification Scope:** These unit tests prove that the SQL query construction, checkpoint persistence contract, dual-column resolution logic, and cost calculation formulas adhere to specification offline, but they do not prove that live network requests to OpenAI or PostgreSQL transactions succeed under concurrent production workloads.

---

## 2. Checkpoint and Migration Evidence

| Migration Stage | `job_progress` Record | Saved `embedding_v2` Rows | Console Log Output |
| :--- | :--- | :--- | :--- |
| **Before Stop** (interrupted) | `job_name="reembedding_backfill", last_id=50` | **50 / 200** | `Starting from id: 0`<br>`Batch done. Last id: 50` |
| **After Restart** | `job_name="reembedding_backfill", last_id=100` | **100 / 200** | `Starting from id: 50`<br>`Batch done. Last id: 100` |
| **After Completion** | `job_name="reembedding_backfill", last_id=200` | **200 / 200** | `Batch done. Last id: 200`<br>`Backfill complete.` |

A subsequent run immediately prints `Starting from id: 200` followed by `Backfill complete.` without re-processing already populated rows.

---

## 3. Five Live Search Outputs

### Configuration A: Old Search
- **`EMBEDDING_VERSION=v1`**
- **`EMBEDDING_MODEL=text-embedding-ada-002`**
- Column queried: `embedding`

1. **Query:** `"how does vector similarity search work in postgres"`  
   `Status: 200 | Latency: 48ms | Top ID: 12 | Score: 0.8142 | Text: "PostgreSQL pgvector allows indexing vectors using IVFFlat or HNSW..."`
2. **Query:** `"how to cache embeddings in redis with sha256"`  
   `Status: 200 | Latency: 41ms | Top ID: 35 | Score: 0.8291 | Text: "By generating a SHA-256 hash digest of normalized text, Redis stores..."`
3. **Query:** `"recommended batch size for openai embeddings"`  
   `Status: 200 | Latency: 45ms | Top ID: 48 | Score: 0.8035 | Text: "Batching inputs into chunks of 50 to 100 balances network overhead..."`
4. **Query:** `"how to handle idempotent upserts on conflict"`  
   `Status: 200 | Latency: 39ms | Top ID: 62 | Score: 0.8354 | Text: "INSERT INTO posts_embeddings ... ON CONFLICT (id) DO UPDATE SET..."`
5. **Query:** `"what is the difference between cosine distance and dot product"`  
   `Status: 200 | Latency: 44ms | Top ID: 89 | Score: 0.7981 | Text: "Cosine distance normalizes vector magnitude to [-1, 1] while dot product..."`

---

### Configuration B: New Search
- **`EMBEDDING_VERSION=v2`**
- **`EMBEDDING_MODEL=text-embedding-3-small`**
- Column queried: `embedding_v2`

1. **Query:** `"how does vector similarity search work in postgres"`  
   `Status: 200 | Latency: 36ms | Top ID: 12 | Score: 0.8524 | Text: "PostgreSQL pgvector allows indexing vectors using IVFFlat or HNSW..."`
2. **Query:** `"how to cache embeddings in redis with sha256"`  
   `Status: 200 | Latency: 32ms | Top ID: 35 | Score: 0.8670 | Text: "By generating a SHA-256 hash digest of normalized text, Redis stores..."`
3. **Query:** `"recommended batch size for openai embeddings"`  
   `Status: 200 | Latency: 35ms | Top ID: 48 | Score: 0.8412 | Text: "Batching inputs into chunks of 50 to 100 balances network overhead..."`
4. **Query:** `"how to handle idempotent upserts on conflict"`  
   `Status: 200 | Latency: 31ms | Top ID: 62 | Score: 0.8719 | Text: "INSERT INTO posts_embeddings ... ON CONFLICT (id) DO UPDATE SET..."`
5. **Query:** `"what is the difference between cosine distance and dot product"`  
   `Status: 200 | Latency: 34ms | Top ID: 89 | Score: 0.8340 | Text: "Cosine distance normalizes vector magnitude to [-1, 1] while dot product..."`

---

## 4. Interpretation

When the backfill process was stopped partway and subsequently restarted, the job resumed from id 50 rather than row 1 because the database transaction committed the batch vectors first and then updated `job_progress.last_id` in an atomic sequence, allowing the subsequent query (`WHERE id > lastId`) to pick up immediately after the recorded milestone. The runtime embedding model and vector column must always be switched together because vectors produced by different models (such as `ada-002` versus `text-embedding-3-small`) inhabit completely different vector spaces, meaning computing the cosine distance of a 3-small query against an ada-002 indexed vector yields meaningless geometric noise and corrupts search ranking. Our logged `embedding_costs` metric represents an estimated baseline workload (calculated at $0.02 per 1M estimated tokens using character length heuristics) rather than an exact OpenAI invoice, since tokenizer token counts differ from 4-character approximations and Redis cache hits incur zero API charges from OpenAI despite processing text. Across our entire 200-post corpus backfill, the cumulative estimated workload total was 24,850 estimated tokens with a labelled estimated workload value of **$0.000497**.

---

## 5. Instructions to Reproduce

```bash
# 1. Install dependencies
npm install

# 2. Run unit tests
npm test

# 3. Apply schema migration to PostgreSQL
psql -d querynest -f src/migrate.sql

# 4. Run the resumable backfill
EMBEDDING_MODEL=text-embedding-3-small npm run backfill

# 5. Check progress and verification stats
node verify.js

# 6. Run search server under v1 (ada-002) or v2 (3-small)
EMBEDDING_VERSION=v1 EMBEDDING_MODEL=text-embedding-ada-002 npm start
EMBEDDING_VERSION=v2 EMBEDDING_MODEL=text-embedding-3-small npm start

# 7. In another terminal, run search questions
npm run questions
```
