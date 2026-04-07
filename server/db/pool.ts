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
    // HIPAA: SSL with certificate verification for production.
    // RDS uses Amazon-issued certificates; rejectUnauthorized: true ensures
    // the server certificate is validated, preventing MITM attacks.
    // Production ALWAYS enforces cert validation (DB_SSL_REJECT_UNAUTHORIZED is ignored).
    // Non-production allows self-signed certs for staging/dev with SSL.
    ssl: process.env.NODE_ENV === "production"
      ? { rejectUnauthorized: true }
      : process.env.DATABASE_URL?.includes("sslmode=require")
        ? { rejectUnauthorized: process.env.DB_SSL_REJECT_UNAUTHORIZED !== "false" }
        : undefined,
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
    // Full-text search indexes on transcript content
    "CREATE EXTENSION IF NOT EXISTS pg_trgm",
    "CREATE INDEX IF NOT EXISTS idx_transcripts_text_trgm ON transcripts USING gin (text gin_trgm_ops)",
    "CREATE INDEX IF NOT EXISTS idx_transcripts_text_fts ON transcripts USING gin (to_tsvector('english', coalesce(text, '')))",
    // Index for employee name lookups (auto-assign)
    "CREATE INDEX IF NOT EXISTS idx_employees_name_lower ON employees (lower(name))",
    // Embedding vector for call clustering (JSONB array of floats)
    "ALTER TABLE call_analyses ADD COLUMN IF NOT EXISTS embedding JSONB",
    // Transcript annotations (timestamped manager comments)
    `CREATE TABLE IF NOT EXISTS annotations (
      id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
      call_id UUID NOT NULL REFERENCES calls(id) ON DELETE CASCADE,
      timestamp_ms INTEGER NOT NULL,
      text TEXT NOT NULL,
      author VARCHAR(255) NOT NULL,
      created_at TIMESTAMPTZ DEFAULT NOW()
    )`,
    "CREATE INDEX IF NOT EXISTS idx_annotations_call_id ON annotations (call_id)",
    // Content hash for upload idempotency (deduplication)
    "ALTER TABLE calls ADD COLUMN IF NOT EXISTS content_hash VARCHAR(64)",
    "CREATE INDEX IF NOT EXISTS idx_calls_content_hash ON calls (content_hash)",
    // Missing indexes for query performance
    "CREATE INDEX IF NOT EXISTS idx_calls_call_category ON calls (call_category)",
    "CREATE INDEX IF NOT EXISTS idx_prompt_templates_category ON prompt_templates (call_category) WHERE is_active = TRUE",
    "CREATE INDEX IF NOT EXISTS idx_usage_call_id ON usage_records (call_id)",
    "CREATE INDEX IF NOT EXISTS idx_audit_log_user_id ON audit_log (user_id)",
    // Gamification badges table
    `CREATE TABLE IF NOT EXISTS badges (
      id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
      employee_id UUID NOT NULL REFERENCES employees(id) ON DELETE CASCADE,
      badge_type VARCHAR(100) NOT NULL,
      call_id UUID REFERENCES calls(id) ON DELETE SET NULL,
      earned_at TIMESTAMPTZ DEFAULT NOW(),
      metadata JSONB DEFAULT '{}'
    )`,
    "CREATE INDEX IF NOT EXISTS idx_badges_employee_id ON badges (employee_id)",
    "CREATE INDEX IF NOT EXISTS idx_badges_badge_type ON badges (badge_type)",
    "CREATE UNIQUE INDEX IF NOT EXISTS idx_badges_unique_milestone ON badges (employee_id, badge_type) WHERE badge_type IN ('first_call', 'calls_25', 'calls_50', 'calls_100')",
    // Password history for HIPAA compliance (prevents reuse of last 5 passwords)
    "ALTER TABLE users ADD COLUMN IF NOT EXISTS password_history JSONB DEFAULT '[]'",
    // Job queue heartbeat (A18) — detect crashed workers via stale heartbeat
    "ALTER TABLE jobs ADD COLUMN IF NOT EXISTS last_heartbeat_at TIMESTAMPTZ",
    "CREATE INDEX IF NOT EXISTS idx_jobs_heartbeat ON jobs (status, last_heartbeat_at) WHERE status = 'running'",
    // Content hash uniqueness (A21) — idempotent upload dedupe. Attempted as
    // unique index; if existing duplicates prevent creation we swallow the
    // error and log rather than crashing startup.
    "CREATE UNIQUE INDEX IF NOT EXISTS idx_calls_content_hash_unique ON calls (content_hash) WHERE content_hash IS NOT NULL",
  ];

  // --- pgvector migration (optional, non-blocking) ---
  // If pgvector extension is available (RDS supports it), create a native VECTOR column
  // for embedding similarity search. Falls back gracefully to the existing JSONB column.
  try {
    await db.query("CREATE EXTENSION IF NOT EXISTS vector");
    // Add native vector column alongside the existing JSONB embedding column
    await db.query("ALTER TABLE call_analyses ADD COLUMN IF NOT EXISTS embedding_vec vector(256)");
    await db.query("CREATE INDEX IF NOT EXISTS idx_call_analyses_embedding ON call_analyses USING ivfflat (embedding_vec vector_cosine_ops) WITH (lists = 50)");
    console.log("[DB] pgvector extension enabled — native vector similarity search available");
  } catch {
    // pgvector not available — JSONB embedding column is the fallback (already exists)
  }
  for (const sql of migrations) {
    try {
      await db.query(sql);
    } catch (err) {
      // Ignore "column already exists" errors
      if (!(err as Error)?.message?.includes("already exists")) {
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
