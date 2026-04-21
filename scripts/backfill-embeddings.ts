/**
 * Backfill embedding_vec (pgvector column) from the existing JSONB embedding
 * column on call_analyses rows. Use after enabling pgvector on an existing
 * deployment so semantic search has full coverage over historical calls.
 *
 * Usage:
 *   npm run backfill-embeddings
 *
 * Idempotent — rows whose embedding_vec is already populated are skipped.
 * Batches updates at 100 rows at a time to bound transaction size.
 *
 * Requires DATABASE_URL. Without it, prints a helpful error and exits 1.
 */
import "dotenv/config";
import { getPool, initializeDatabase, isPgvectorAvailable } from "../server/db/pool";
import { logger } from "../server/services/logger";

async function main() {
  if (!process.env.DATABASE_URL) {
    console.error("DATABASE_URL is required for the backfill script.");
    process.exit(1);
  }

  await initializeDatabase();
  const pool = getPool();
  if (!pool) {
    console.error("Failed to initialize database pool.");
    process.exit(1);
  }
  if (!isPgvectorAvailable()) {
    console.error(
      "pgvector extension is not available on this database. Verify the " +
      "database image supports pgvector (RDS PostgreSQL 15.2+) and re-run " +
      "startup to trigger the migration.",
    );
    process.exit(1);
  }

  // Count total candidates for progress reporting.
  const { rows: countRows } = await pool.query<{ cnt: string }>(
    `SELECT COUNT(*)::text AS cnt
     FROM call_analyses
     WHERE embedding IS NOT NULL AND embedding_vec IS NULL`,
  );
  const total = parseInt(countRows[0]?.cnt ?? "0", 10);
  if (total === 0) {
    console.log("No rows need backfill — embedding_vec is already populated for every row with a JSONB embedding.");
    process.exit(0);
  }

  console.log(`Backfilling embedding_vec for ${total} rows (batch size 100)...`);
  let done = 0;
  const BATCH = 100;

  // Loop: fetch up to BATCH candidates, write their vec, repeat until empty.
  // A CTE would be faster but this keeps per-batch timing visible.
  while (true) {
    const { rows } = await pool.query<{ id: string; embedding: number[] }>(
      `SELECT id, embedding
       FROM call_analyses
       WHERE embedding IS NOT NULL AND embedding_vec IS NULL
       LIMIT $1`,
      [BATCH],
    );
    if (rows.length === 0) break;

    for (const row of rows) {
      const emb = row.embedding;
      if (!Array.isArray(emb) || emb.length === 0) {
        // Row has a malformed embedding — null it out so future backfill
        // passes skip it. Otherwise we'd loop forever on bad data.
        await pool.query(
          `UPDATE call_analyses SET embedding = NULL WHERE id = $1`,
          [row.id],
        );
        continue;
      }
      try {
        await pool.query(
          `UPDATE call_analyses SET embedding_vec = $1::vector WHERE id = $2`,
          [`[${emb.join(",")}]`, row.id],
        );
        done++;
      } catch (err) {
        logger.warn("Failed to backfill row — skipping", {
          rowId: row.id,
          error: (err as Error).message,
        });
      }
    }
    console.log(`  ${done} / ${total} rows backfilled`);
  }

  console.log(`Done. ${done} rows backfilled. Semantic search can now use the pgvector fast path for historical data.`);
  process.exit(0);
}

main().catch(err => {
  console.error("Backfill failed:", err);
  process.exit(1);
});
