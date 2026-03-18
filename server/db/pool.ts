/**
 * PostgreSQL connection pool.
 *
 * Reads DATABASE_URL from environment. Returns null if not configured,
 * allowing the app to fall back to S3 or in-memory storage.
 */
import pg from "pg";

let pool: pg.Pool | null = null;

export function getPool(): pg.Pool | null {
  if (pool) return pool;

  const connectionString = process.env.DATABASE_URL;
  if (!connectionString) return null;

  pool = new pg.Pool({
    connectionString,
    max: 20,
    idleTimeoutMillis: 30_000,
    connectionTimeoutMillis: 5_000,
    // Use SSL in production (RDS requires it)
    ssl: process.env.NODE_ENV === "production" ? { rejectUnauthorized: false } : undefined,
  });

  pool.on("error", (err) => {
    console.error("[DB] Unexpected pool error:", err.message);
  });

  return pool;
}

/**
 * Run the schema.sql migration if tables don't exist yet.
 */
export async function initializeDatabase(): Promise<void> {
  const db = getPool();
  if (!db) return;

  try {
    // Check if schema is already initialized by looking for the calls table
    const result = await db.query(`
      SELECT EXISTS (
        SELECT FROM information_schema.tables WHERE table_name = 'calls'
      )
    `);

    if (result.rows[0].exists) {
      console.log("[DB] Schema already initialized");
      // Run lightweight migrations for new columns on existing databases
      await runMigrations(db);
      return;
    }

    // Read and execute schema.sql
    const fs = await import("fs");
    const path = await import("path");
    const schemaPath = path.join(import.meta.dirname, "schema.sql");
    const schemaSql = fs.readFileSync(schemaPath, "utf-8");
    await db.query(schemaSql);
    console.log("[DB] Schema initialized successfully");
  } catch (error) {
    console.error("[DB] Failed to initialize schema:", (error as Error).message);
    throw error;
  }
}

/**
 * Run lightweight ALTER TABLE migrations for new columns added after initial schema.
 * Each migration is idempotent (IF NOT EXISTS / catches "already exists" errors).
 */
async function runMigrations(db: import("pg").Pool): Promise<void> {
  const migrations = [
    "ALTER TABLE employees ADD COLUMN IF NOT EXISTS pseudonym VARCHAR(500)",
    "ALTER TABLE employees ADD COLUMN IF NOT EXISTS extension VARCHAR(50)",
    // MFA secrets table
    `CREATE TABLE IF NOT EXISTS mfa_secrets (
      username VARCHAR(255) PRIMARY KEY,
      secret VARCHAR(255) NOT NULL,
      enabled BOOLEAN DEFAULT FALSE,
      created_at TIMESTAMPTZ DEFAULT NOW()
    )`,
    // Breach reports table (HIPAA §164.408)
    `CREATE TABLE IF NOT EXISTS breach_reports (
      id VARCHAR(255) PRIMARY KEY,
      reported_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
      reported_by VARCHAR(255) NOT NULL,
      description TEXT NOT NULL,
      affected_individuals INTEGER NOT NULL DEFAULT 0,
      data_types JSONB NOT NULL DEFAULT '[]',
      discovery_date VARCHAR(100) NOT NULL,
      containment_actions TEXT,
      notification_status VARCHAR(50) DEFAULT 'pending',
      timeline JSONB DEFAULT '[]'
    )`,
    // Call tags table
    `CREATE TABLE IF NOT EXISTS call_tags (
      id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
      call_id UUID NOT NULL REFERENCES calls(id) ON DELETE CASCADE,
      tag VARCHAR(100) NOT NULL,
      created_by VARCHAR(255) NOT NULL,
      created_at TIMESTAMPTZ DEFAULT NOW(),
      UNIQUE(call_id, tag)
    )`,
    "CREATE INDEX IF NOT EXISTS idx_call_tags_call_id ON call_tags (call_id)",
    "CREATE INDEX IF NOT EXISTS idx_call_tags_tag ON call_tags (tag)",
  ];
  for (const sql of migrations) {
    try {
      await db.query(sql);
    } catch (err) {
      // Ignore "column already exists" errors
      if (!(err as any)?.message?.includes("already exists")) {
        console.warn("[DB] Migration warning:", (err as Error).message);
      }
    }
  }
}

/**
 * Gracefully close the pool (call on shutdown).
 */
export async function closePool(): Promise<void> {
  if (pool) {
    await pool.end();
    pool = null;
  }
}
