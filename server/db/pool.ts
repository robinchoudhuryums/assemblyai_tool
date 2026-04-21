/**
 * PostgreSQL connection pool.
 *
 * Reads DATABASE_URL from environment. Returns null if not configured,
 * allowing the app to fall back to S3 or in-memory storage.
 */
import pg from "pg";
import fs from "fs";
import path from "path";
import { logger } from "../services/logger";

let pool: pg.Pool | null = null;

/**
 * Locate the AWS RDS CA bundle so production TLS verification works
 * even when the caller hasn't set NODE_EXTRA_CA_CERTS. pm2 sets that env
 * var via ecosystem.config.cjs for the main app process, but one-off
 * scripts (seed-admin, seed, migration helpers) don't inherit it and
 * previously failed with "self-signed certificate in certificate chain".
 *
 * Resolution order:
 *   1. NODE_EXTRA_CA_CERTS (if set AND readable) — canonical path,
 *      Node has already loaded it into the global trust store.
 *   2. `RDS_CA_BUNDLE = "<path>"` inside ecosystem.config.cjs — matches
 *      the deploy's source of truth so docs stay accurate.
 *   3. Well-known EC2 defaults (ec2-user / ubuntu homedirs).
 *
 * Returns the resolved CA content (PEM string), or undefined if no bundle
 * could be located. Callers that find nothing fall back to Node's default
 * trust store — which is what the old behavior was.
 */
function resolveRdsCaBundle(): string | undefined {
  const candidates: string[] = [];

  // 1. Honor NODE_EXTRA_CA_CERTS first so the pm2 path is byte-identical.
  if (process.env.NODE_EXTRA_CA_CERTS) {
    candidates.push(process.env.NODE_EXTRA_CA_CERTS);
  }

  // 2. Parse ecosystem.config.cjs for the operator's declared path.
  try {
    const ecosystemPath = path.resolve(process.cwd(), "ecosystem.config.cjs");
    if (fs.existsSync(ecosystemPath)) {
      const content = fs.readFileSync(ecosystemPath, "utf8");
      const match = /RDS_CA_BUNDLE\s*=\s*["']([^"']+)["']/.exec(content);
      if (match) candidates.push(match[1]);
    }
  } catch {
    // ignore — ecosystem file parsing is best-effort
  }

  // 3. Well-known default EC2 locations.
  candidates.push("/home/ec2-user/global-bundle.pem");
  candidates.push("/home/ubuntu/global-bundle.pem");

  for (const candidate of candidates) {
    try {
      if (fs.existsSync(candidate)) {
        return fs.readFileSync(candidate, "utf8");
      }
    } catch {
      // permission error / unreadable — try next
    }
  }
  return undefined;
}

export function getPool(): pg.Pool | null {
  if (pool) return pool;

  const connectionString = process.env.DATABASE_URL;
  if (!connectionString) return null;

  // HIPAA: SSL with certificate verification for production.
  // RDS uses Amazon-issued certificates; rejectUnauthorized: true ensures
  // the server certificate is validated, preventing MITM attacks.
  // Production ALWAYS enforces cert validation (DB_SSL_REJECT_UNAUTHORIZED is ignored).
  // Non-production allows self-signed certs for staging/dev with SSL.
  //
  // When NODE_EXTRA_CA_CERTS is unset (e.g. seed-admin, one-off scripts),
  // we fall back to reading the CA bundle directly into the pg config via
  // `ssl.ca`. This keeps `rejectUnauthorized: true` intact.
  let sslConfig: pg.PoolConfig["ssl"];
  if (process.env.NODE_ENV === "production") {
    const ca = resolveRdsCaBundle();
    sslConfig = ca ? { rejectUnauthorized: true, ca } : { rejectUnauthorized: true };
  } else if (process.env.DATABASE_URL?.includes("sslmode=require")) {
    sslConfig = { rejectUnauthorized: process.env.DB_SSL_REJECT_UNAUTHORIZED !== "false" };
  } else {
    sslConfig = undefined;
  }

  pool = new pg.Pool({
    connectionString,
    max: 20,
    idleTimeoutMillis: 30_000,
    connectionTimeoutMillis: 5_000,
    ssl: sslConfig,
  });

  pool.on("error", (err) => {
    logger.error("Unexpected pool error", { error: err.message });
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
      logger.info("Schema already initialized");
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
    logger.info("Schema initialized successfully");
  } catch (error) {
    logger.error("Failed to initialize schema", { error: (error as Error).message });
    throw error;
  }
}

/**
 * Run lightweight ALTER TABLE migrations for new columns added after initial schema.
 * Each migration is idempotent (IF NOT EXISTS / catches "already exists" errors).
 */
/**
 * Whether pgvector was successfully installed during migration. Consulted by
 * PostgresStorage and the semantic-search route to decide between SQL-native
 * cosine similarity (O(log N) with HNSW/IVFFlat) and the in-memory fallback.
 */
let pgvectorAvailable = false;
export function isPgvectorAvailable(): boolean {
  return pgvectorAvailable;
}

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
    // A2/F01: badges table now lives in schema.sql as the source of truth.
    // The block below is an idempotent MIRROR for databases that were
    // initialized before A2 (i.e. existing deployments where the calls table
    // already exists, so initializeDatabase() short-circuits past the
    // schema.sql apply step). Keep these in sync with schema.sql.
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
    // A10: external_id for upstream-source dedupe (e.g. 8x8 recording ids).
    // Unique partial index lets multiple non-telephony rows with NULL coexist.
    "ALTER TABLE calls ADD COLUMN IF NOT EXISTS external_id VARCHAR(255)",
    "CREATE UNIQUE INDEX IF NOT EXISTS idx_calls_external_id_unique ON calls (external_id) WHERE external_id IS NOT NULL",
    // A3/F02: scheduled_reports — mirror of schema.sql for existing DBs.
    `CREATE TABLE IF NOT EXISTS scheduled_reports (
      id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
      type VARCHAR(20) NOT NULL,
      period_start TIMESTAMPTZ NOT NULL,
      period_end TIMESTAMPTZ NOT NULL,
      generated_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
      generated_by VARCHAR(255) NOT NULL,
      data JSONB NOT NULL,
      UNIQUE (type, period_start)
    )`,
    "CREATE INDEX IF NOT EXISTS idx_scheduled_reports_type_period ON scheduled_reports (type, period_start DESC)",
    "CREATE INDEX IF NOT EXISTS idx_scheduled_reports_generated_at ON scheduled_reports (generated_at DESC)",
    // MFA recovery codes — scrypt-hashed, single-use recovery tokens for lost-device flow
    "ALTER TABLE mfa_secrets ADD COLUMN IF NOT EXISTS recovery_codes JSONB DEFAULT '[]'",
    // Simulated Call Generator — synthetic flag on calls + dedicated table.
    // See docs in schema.sql. The column is NOT NULL DEFAULT FALSE on new
    // deploys; for upgrades, the two-step ADD + UPDATE + SET NOT NULL pattern
    // avoids rewriting the whole calls table at once on large tables.
    "ALTER TABLE calls ADD COLUMN IF NOT EXISTS synthetic BOOLEAN DEFAULT FALSE",
    "UPDATE calls SET synthetic = FALSE WHERE synthetic IS NULL",
    "ALTER TABLE calls ALTER COLUMN synthetic SET NOT NULL",
    "CREATE INDEX IF NOT EXISTS idx_calls_synthetic_false ON calls (uploaded_at DESC) WHERE synthetic = FALSE",
    // Manager-set exclusion flag for real calls. Same 3-step ADD/UPDATE/SET NOT NULL
    // pattern as synthetic. Aggregate queries (leaderboards, dashboards, reports,
    // badge eval, coaching outcomes) filter on this alongside synthetic.
    "ALTER TABLE calls ADD COLUMN IF NOT EXISTS excluded_from_metrics BOOLEAN DEFAULT FALSE",
    "UPDATE calls SET excluded_from_metrics = FALSE WHERE excluded_from_metrics IS NULL",
    "ALTER TABLE calls ALTER COLUMN excluded_from_metrics SET NOT NULL",
    // Coaching effectiveness rating (subjective manager closure signal).
    // Complements the statistical before/after outcome with causal judgment.
    "ALTER TABLE coaching_sessions ADD COLUMN IF NOT EXISTS effectiveness_rating VARCHAR(20)",
    "ALTER TABLE coaching_sessions ADD COLUMN IF NOT EXISTS effectiveness_note TEXT",
    `CREATE TABLE IF NOT EXISTS simulated_calls (
      id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
      title VARCHAR(500) NOT NULL,
      scenario TEXT,
      quality_tier VARCHAR(50),
      equipment VARCHAR(255),
      status VARCHAR(50) NOT NULL DEFAULT 'pending',
      script JSONB NOT NULL,
      config JSONB NOT NULL,
      audio_s3_key VARCHAR(500),
      audio_format VARCHAR(20) DEFAULT 'mp3',
      duration_seconds INTEGER,
      tts_char_count INTEGER DEFAULT 0,
      estimated_cost NUMERIC(10,4) DEFAULT 0,
      error TEXT,
      created_by VARCHAR(255) NOT NULL,
      sent_to_analysis_call_id UUID REFERENCES calls(id) ON DELETE SET NULL,
      created_at TIMESTAMPTZ DEFAULT NOW(),
      updated_at TIMESTAMPTZ DEFAULT NOW()
    )`,
    "CREATE INDEX IF NOT EXISTS idx_simulated_calls_status ON simulated_calls (status)",
    "CREATE INDEX IF NOT EXISTS idx_simulated_calls_created_by ON simulated_calls (created_by)",
    "CREATE INDEX IF NOT EXISTS idx_simulated_calls_created_at ON simulated_calls (created_at DESC)",
  ];

  // --- pgvector migration (optional, non-blocking) ---
  // If pgvector extension is available (RDS supports it), create a native VECTOR column
  // for embedding similarity search. Falls back gracefully to the existing JSONB column.
  try {
    await db.query("CREATE EXTENSION IF NOT EXISTS vector");
    // Add native vector column alongside the existing JSONB embedding column
    await db.query("ALTER TABLE call_analyses ADD COLUMN IF NOT EXISTS embedding_vec vector(256)");
    await db.query("CREATE INDEX IF NOT EXISTS idx_call_analyses_embedding ON call_analyses USING ivfflat (embedding_vec vector_cosine_ops) WITH (lists = 50)");
    pgvectorAvailable = true;
    logger.info("pgvector extension enabled — native vector similarity search available");
  } catch {
    // pgvector not available — JSONB embedding column is the fallback (already exists)
    pgvectorAvailable = false;
  }
  for (const sql of migrations) {
    try {
      await db.query(sql);
    } catch (err) {
      // Ignore "column already exists" errors
      if (!(err as Error)?.message?.includes("already exists")) {
        logger.warn("Migration warning", { error: (err as Error).message });
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
