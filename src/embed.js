import { createHash } from 'crypto';
import { db, redis, llm } from './infra.js';

/**
 * Embeds text using Redis cache and logs cost estimate to embedding_costs.
 * @param {string} text
 * @param {{ model?: string, dbClient?: any, redisClient?: any, llmClient?: any }} [opts]
 * @returns {Promise<number[]>}
 */
export async function embed(text, opts = {}) {
  const model = opts.model || process.env.EMBEDDING_MODEL || 'text-embedding-3-small';
  const dbClient = opts.dbClient || db;
  const redisClient = opts.redisClient || redis;
  const llmClient = opts.llmClient || llm;

  const key = `emb:${model}:` + createHash('sha256').update(text).digest('hex');

  let vector = null;

  try {
    const cached = await redisClient.get(key);
    if (cached) {
      vector = JSON.parse(cached);
    }
  } catch (err) {
    // Non-fatal cache lookup failure
  }

  if (!vector) {
    const res = await llmClient.embeddings.create({
      model,
      input: text,
    });
    vector = res.data[0].embedding;

    try {
      await redisClient.set(key, JSON.stringify(vector));
    } catch (err) {
      // Non-fatal cache write failure
    }
  }

  // TODO 6: record cost estimate into embedding_costs table
  // after the vector is obtained, insert one row into embedding_costs with
  // the model, text.length, Math.ceil(text.length / 4) and (tokens / 1_000_000) * 0.02.
  // Catch a logging failure so it never stops the migration.
  throw new Error('TODO 6: implement cost logging in embed.js');

  return vector;
}

export async function logEmbeddingCost(dbClient, model, text) {
  // Helper for logging cost estimate
  throw new Error('TODO 6: implement logEmbeddingCost');
}
