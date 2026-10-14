import test from 'node:test';
import assert from 'node:assert/strict';
import { getCheckpoint, fetchBatch, saveCheckpoint } from '../src/backfill.js';
import { resolveSearchColumn } from '../src/routes/search.js';
import { logEmbeddingCost } from '../src/embed.js';

test('read checkpoint returns 0 when no row exists, or last_id when present', async () => {
  const emptyDb = {
    query: async (sql, params) => {
      assert.ok(sql.includes('FROM job_progress'));
      assert.strictEqual(params[0], 'reembedding_backfill');
      return { rows: [] };
    },
  };

  const initialCheckpoint = await getCheckpoint(emptyDb, 'reembedding_backfill');
  assert.strictEqual(initialCheckpoint, 0, 'Should start at 0 when no checkpoint exists');

  const populatedDb = {
    query: async (sql, params) => {
      return { rows: [{ last_id: 150 }] };
    },
  };

  const savedCheckpoint = await getCheckpoint(populatedDb, 'reembedding_backfill');
  assert.strictEqual(savedCheckpoint, 150, 'Should return last_id from row');
});

test('fetch batch queries id > lastId, embedding_v2 IS NULL, ordered by id with limit 50', async () => {
  let executedSql = '';
  let passedParams = [];

  const mockDb = {
    query: async (sql, params) => {
      executedSql = sql;
      passedParams = params;
      return {
        rows: [
          { id: 101, text: 'Sample post text 101' },
          { id: 102, text: 'Sample post text 102' },
        ],
      };
    },
  };

  const rows = await fetchBatch(mockDb, 100, 50);

  assert.ok(executedSql.includes('id > $1'), 'SQL must filter id > lastId');
  assert.ok(executedSql.includes('embedding_v2 IS NULL'), 'SQL must ensure embedding_v2 IS NULL');
  assert.ok(executedSql.includes('ORDER BY id'), 'SQL must order by id');
  assert.ok(executedSql.includes('LIMIT $2') || executedSql.includes('LIMIT 50'), 'SQL must limit batch size');
  assert.strictEqual(passedParams[0], 100, 'Param $1 must be lastId');
  assert.strictEqual(rows.length, 2);
});

test('search route selects embedding_v2 for v2 and embedding for v1', () => {
  const colV2 = resolveSearchColumn('v2');
  assert.strictEqual(colV2, 'embedding_v2', 'v2 must select embedding_v2 column');

  const colV1 = resolveSearchColumn('v1');
  assert.strictEqual(colV1, 'embedding', 'v1 must select embedding column');

  const colDefault = resolveSearchColumn(undefined);
  assert.strictEqual(colDefault, 'embedding', 'Default/missing version must fallback to embedding column');
});

test('cost logger calculates tokens and cost, and ignores db error', async () => {
  let loggedValues = null;

  const mockDb = {
    query: async (sql, params) => {
      assert.ok(sql.includes('INSERT INTO embedding_costs'));
      loggedValues = params;
      return { rowCount: 1 };
    },
  };

  const text = 'This is a test sentence for embedding cost calculation.'; // 55 chars
  // Math.ceil(55 / 4) = 14 tokens
  // Cost = (14 / 1_000_000) * 0.02 = 0.00000028
  const expectedTokens = Math.ceil(text.length / 4);
  const expectedCost = (expectedTokens / 1_000_000) * 0.02;

  await logEmbeddingCost(mockDb, 'text-embedding-3-small', text);

  assert.ok(loggedValues !== null, 'Cost should have been logged');
  assert.strictEqual(loggedValues[0], 'text-embedding-3-small');
  assert.strictEqual(loggedValues[1], text.length);
  assert.strictEqual(loggedValues[2], expectedTokens);
  assert.strictEqual(loggedValues[3], expectedCost);

  // Catch logging failure so it never stops migration
  const failingDb = {
    query: async () => {
      throw new Error('Database connection failed');
    },
  };

  await assert.doesNotReject(async () => {
    await logEmbeddingCost(failingDb, 'text-embedding-3-small', text);
  }, 'Logging failure must be caught and ignored');
});
