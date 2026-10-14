import { db } from './infra.js';
import { embed } from './embed.js';

export async function getCheckpoint(dbClient, jobName = 'reembedding_backfill') {
  // TODO 1: read last_id from job_progress, or start at 0 if there is no row
  throw new Error('TODO 1: implement getCheckpoint');
}

export async function fetchBatch(dbClient, lastId, batchSize = 50) {
  // TODO 2: select up to 50 rows where id > lastId AND embedding_v2 IS NULL, ordered by id
  throw new Error('TODO 2: implement fetchBatch');
}

export async function saveCheckpoint(dbClient, jobName, lastId) {
  // TODO 3: write lastId with INSERT ... ON CONFLICT (job_name) DO UPDATE
  throw new Error('TODO 3: implement saveCheckpoint');
}

export function pause(ms = 200) {
  // TODO 4: wait 200 ms between batches
  throw new Error('TODO 4: implement pause');
}

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
