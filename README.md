# Re-embedding Pipeline Mini Project

Upgrading vector embeddings from `text-embedding-ada-002` to `text-embedding-3-small` using dual columns, resumable checkpoints, and cost logging.

## Setup & Running

```bash
npm install
npm test
node verify.js # Run src/migrate.sql with your PostgreSQL client first.

# 1. Backfill with text-embedding-3-small (supports stopping partway and restarting)
EMBEDDING_MODEL=text-embedding-3-small npm run backfill

# 2. Test old search (v1)
EMBEDDING_VERSION=v1 EMBEDDING_MODEL=text-embedding-ada-002 npm start

# 3. Test new search (v2)
EMBEDDING_VERSION=v2 EMBEDDING_MODEL=text-embedding-3-small npm start

# 4. In a second terminal, run search questions
npm run questions
```

## TODO Checklist
- [ ] TODO 1: Read checkpoint from `job_progress`
- [ ] TODO 2: Fetch batch of 50 rows where `id > lastId AND embedding_v2 IS NULL`
- [ ] TODO 3: Save progress with `INSERT ... ON CONFLICT (job_name) DO UPDATE`
- [ ] TODO 4: Pause 200ms between batches
- [ ] TODO 5: Search column choice: `embedding_v2` for `v2`, otherwise `embedding`
- [ ] TODO 6: Record cost estimate into `embedding_costs` table
