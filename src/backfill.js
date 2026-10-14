import { db } from './infra.js';
import { embed } from './embed.js';

/**
 * Reads last_id from job_progress, or starts at 0 if there is no row.
 * @param {any} dbClient
 * @param {string} [jobName]
 * @returns {Promise<number>}
 */
export async function getCheckpoint(dbClient, jobName = 'reembedding_backfill') {
  // TODO 1: read last_id from job_progress, or start at 0 if there is no row
  const res = await dbClient.query(
    'SELECT last_id FROM job_progress WHERE job_name = $1',
    [jobName]
  );
  return res.rows.length > 0 ? Number(res.rows[0].last_id) : 0;
}

/**
 * Selects up to 50 rows where id > lastId AND embedding_v2 IS NULL, ordered by id.
 * @param {any} dbClient
 * @param {number} lastId
 * @param {number} [batchSize]
 * @returns {Promise<Array<{ id: number, text: string }>>}
 */
export async function fetchBatch(dbClient, lastId, batchSize = 50) {
  // TODO 2: select up to 50 rows where id > lastId AND embedding_v2 IS NULL, ordered by id
  const res = await dbClient.query(
    'SELECT id, text FROM posts_embeddings WHERE id > $1 AND embedding_v2 IS NULL ORDER BY id ASC LIMIT $2',
    [lastId, batchSize]
  );
  return res.rows;
}

/**
 * Saves progress checkpoint with INSERT ... ON CONFLICT (job_name) DO UPDATE.
 * @param {any} dbClient
 * @param {string} jobName
 * @param {number} lastId
 * @returns {Promise<void>}
 */
export async function saveCheckpoint(dbClient, jobName, lastId) {
  // TODO 3: write lastId with INSERT ... ON CONFLICT (job_name) DO UPDATE
  await dbClient.query(
    `INSERT INTO job_progress (job_name, last_id, updated_at)
     VALUES ($1, $2, now())
     ON CONFLICT (job_name) DO UPDATE SET
       last_id = EXCLUDED.last_id,
       updated_at = now()`,
    [jobName, lastId]
  );
}

/**
 * Pauses execution for the specified milliseconds (default 200ms).
 * @param {number} [ms]
 * @returns {Promise<void>}
 */
export function pause(ms = 200) {
  // TODO 4: wait 200 ms between batches
  return new Promise((resolve) => setTimeout(resolve, ms));
}

/**
 * Runs the resumable backfill loop.
 * @param {any} [dbClient]
 */
export async function runBackfill(dbClient = db) {
  const jobName = 'reembedding_backfill';
  let lastId = await getCheckpoint(dbClient, jobName);
  console.log(`Starting from id: ${lastId}`);

  while (true) {
    const rows = await fetchBatch(dbClient, lastId, 50);
    if (!rows || rows.length === 0) {
      console.log('Backfill complete.');
      break;
    }

    // Vector-writing loop (done for you):
    for (const row of rows) {
      const vector = await embed(row.text, {
        model: process.env.EMBEDDING_MODEL || 'text-embedding-3-small',
        dbClient,
      });
      await dbClient.query(
        'UPDATE posts_embeddings SET embedding_v2 = $1::vector WHERE id = $2',
        [JSON.stringify(vector), row.id]
      );
    }

    const batchLastId = rows[rows.length - 1].id;
    lastId = batchLastId;

    await saveCheckpoint(dbClient, jobName, lastId);
    console.log(`Batch done. Last id: ${lastId}`);

    await pause(200);
  }
}

if (process.argv[1] && process.argv[1].endsWith('backfill.js')) {
  runBackfill()
    .then(() => process.exit(0))
    .catch((err) => {
      console.error('Backfill failed:', err);
      process.exit(1);
    });
}
