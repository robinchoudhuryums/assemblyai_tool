-- CallAnalyzer PostgreSQL Schema
-- Run this once against your RDS instance to initialize the database.
-- Usage: psql $DATABASE_URL -f server/db/schema.sql

-- Enable UUID generation
CREATE EXTENSION IF NOT EXISTS "pgcrypto";
-- Enable trigram similarity for fast ILIKE text search
CREATE EXTENSION IF NOT EXISTS "pg_trgm";

-- ============================================================
-- Session store (used by connect-pg-simple)
-- ============================================================
CREATE TABLE IF NOT EXISTS "session" (
  "sid" VARCHAR NOT NULL PRIMARY KEY,
  "sess" JSON NOT NULL,
  "expire" TIMESTAMP(6) NOT NULL
);
CREATE INDEX IF NOT EXISTS "IDX_session_expire" ON "session" ("expire");

-- ============================================================
-- Employees
-- ============================================================
CREATE TABLE IF NOT EXISTS employees (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  name VARCHAR(255) NOT NULL,
  role VARCHAR(100),
  email VARCHAR(255) NOT NULL,
  initials VARCHAR(2),
  status VARCHAR(50) DEFAULT 'Active',
  sub_team VARCHAR(100),
  pseudonym VARCHAR(500),
  extension VARCHAR(50),
  created_at TIMESTAMPTZ DEFAULT NOW()
);
CREATE INDEX IF NOT EXISTS idx_employees_email ON employees (email);

-- ============================================================
-- Calls
-- ============================================================
CREATE TABLE IF NOT EXISTS calls (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  employee_id UUID REFERENCES employees(id) ON DELETE SET NULL,
  file_name VARCHAR(500),
  file_path VARCHAR(500),
  status VARCHAR(50) DEFAULT 'pending',
  duration INTEGER,
  assembly_ai_id VARCHAR(255),
  call_category VARCHAR(50),
  content_hash VARCHAR(64),
  external_id VARCHAR(255),
  uploaded_at TIMESTAMPTZ DEFAULT NOW()
);
CREATE INDEX IF NOT EXISTS idx_calls_status ON calls (status);
CREATE INDEX IF NOT EXISTS idx_calls_uploaded_at ON calls (uploaded_at DESC);
CREATE INDEX IF NOT EXISTS idx_calls_employee_id ON calls (employee_id);
CREATE INDEX IF NOT EXISTS idx_calls_call_category ON calls (call_category);
CREATE INDEX IF NOT EXISTS idx_calls_content_hash ON calls (content_hash);
CREATE UNIQUE INDEX IF NOT EXISTS idx_calls_external_id_unique ON calls (external_id) WHERE external_id IS NOT NULL;

-- ============================================================
-- Transcripts (1:1 per call)
-- ============================================================
CREATE TABLE IF NOT EXISTS transcripts (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  call_id UUID NOT NULL UNIQUE REFERENCES calls(id) ON DELETE CASCADE,
  text TEXT,
  confidence VARCHAR(50),
  words JSONB,
  created_at TIMESTAMPTZ DEFAULT NOW()
);

-- Full-text search index for transcript content (speeds up ILIKE and tsvector queries)
CREATE INDEX IF NOT EXISTS idx_transcripts_text_trgm ON transcripts USING gin (text gin_trgm_ops);
CREATE INDEX IF NOT EXISTS idx_transcripts_text_fts ON transcripts USING gin (to_tsvector('english', coalesce(text, '')));

-- ============================================================
-- Sentiment Analyses (1:1 per call)
-- ============================================================
CREATE TABLE IF NOT EXISTS sentiment_analyses (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  call_id UUID NOT NULL UNIQUE REFERENCES calls(id) ON DELETE CASCADE,
  overall_sentiment VARCHAR(50),
  overall_score VARCHAR(50),
  segments JSONB,
  created_at TIMESTAMPTZ DEFAULT NOW()
);

-- ============================================================
-- Call Analyses (1:1 per call)
-- ============================================================
CREATE TABLE IF NOT EXISTS call_analyses (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  call_id UUID NOT NULL UNIQUE REFERENCES calls(id) ON DELETE CASCADE,
  performance_score VARCHAR(50),
  talk_time_ratio VARCHAR(50),
  response_time VARCHAR(50),
  keywords JSONB,
  topics JSONB,
  summary TEXT,
  action_items JSONB,
  feedback JSONB,
  lemur_response JSONB,
  call_party_type VARCHAR(100),
  flags JSONB,
  manual_edits JSONB,
  confidence_score VARCHAR(50),
  confidence_factors JSONB,
  sub_scores JSONB,
  detected_agent_name VARCHAR(255),
  created_at TIMESTAMPTZ DEFAULT NOW()
);

-- ============================================================
-- Access Requests
-- ============================================================
CREATE TABLE IF NOT EXISTS access_requests (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  name VARCHAR(255) NOT NULL,
  email VARCHAR(255) NOT NULL,
  reason TEXT,
  requested_role VARCHAR(50) DEFAULT 'viewer',
  status VARCHAR(50) DEFAULT 'pending',
  reviewed_by VARCHAR(255),
  reviewed_at TIMESTAMPTZ,
  created_at TIMESTAMPTZ DEFAULT NOW()
);

-- ============================================================
-- Prompt Templates
-- ============================================================
CREATE TABLE IF NOT EXISTS prompt_templates (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  call_category VARCHAR(100) NOT NULL,
  name VARCHAR(255) NOT NULL,
  evaluation_criteria TEXT NOT NULL,
  required_phrases JSONB,
  scoring_weights JSONB,
  additional_instructions TEXT,
  is_active BOOLEAN DEFAULT TRUE,
  updated_at TIMESTAMPTZ DEFAULT NOW(),
  updated_by VARCHAR(255)
);
CREATE INDEX IF NOT EXISTS idx_prompt_templates_category ON prompt_templates (call_category) WHERE is_active = TRUE;

-- ============================================================
-- Coaching Sessions
-- ============================================================
CREATE TABLE IF NOT EXISTS coaching_sessions (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  employee_id UUID NOT NULL REFERENCES employees(id) ON DELETE CASCADE,
  call_id UUID REFERENCES calls(id) ON DELETE SET NULL,
  assigned_by VARCHAR(255) NOT NULL,
  category VARCHAR(100) DEFAULT 'general',
  title VARCHAR(500) NOT NULL,
  notes TEXT,
  action_plan JSONB,
  status VARCHAR(50) DEFAULT 'pending',
  due_date TIMESTAMPTZ,
  created_at TIMESTAMPTZ DEFAULT NOW(),
  completed_at TIMESTAMPTZ
);
CREATE INDEX IF NOT EXISTS idx_coaching_employee ON coaching_sessions (employee_id);

-- ============================================================
-- A/B Tests
-- ============================================================
CREATE TABLE IF NOT EXISTS ab_tests (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  file_name VARCHAR(500) NOT NULL,
  call_category VARCHAR(100),
  baseline_model VARCHAR(255) NOT NULL,
  test_model VARCHAR(255) NOT NULL,
  status VARCHAR(50) DEFAULT 'processing',
  transcript_text TEXT,
  baseline_analysis JSONB,
  test_analysis JSONB,
  baseline_latency_ms INTEGER,
  test_latency_ms INTEGER,
  notes TEXT,
  created_by VARCHAR(255) NOT NULL,
  created_at TIMESTAMPTZ DEFAULT NOW()
);

-- ============================================================
-- Usage Records (spend tracking)
-- ============================================================
CREATE TABLE IF NOT EXISTS usage_records (
  id UUID PRIMARY KEY,
  call_id UUID NOT NULL,
  type VARCHAR(50) NOT NULL,
  timestamp TIMESTAMPTZ NOT NULL,
  "user" VARCHAR(255) NOT NULL,
  services JSONB NOT NULL,
  total_estimated_cost NUMERIC(10,4) NOT NULL
);
CREATE INDEX IF NOT EXISTS idx_usage_timestamp ON usage_records (timestamp DESC);
CREATE INDEX IF NOT EXISTS idx_usage_call_id ON usage_records (call_id);

-- ============================================================
-- Job Queue (durable async processing)
-- ============================================================
CREATE TABLE IF NOT EXISTS jobs (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  type VARCHAR(50) NOT NULL,
  status VARCHAR(20) NOT NULL DEFAULT 'pending',
  payload JSONB NOT NULL,
  priority INTEGER DEFAULT 0,
  attempts INTEGER DEFAULT 0,
  max_attempts INTEGER DEFAULT 3,
  locked_at TIMESTAMPTZ,
  locked_by VARCHAR(100),
  last_heartbeat_at TIMESTAMPTZ,
  completed_at TIMESTAMPTZ,
  failed_reason TEXT,
  created_at TIMESTAMPTZ DEFAULT NOW(),
  updated_at TIMESTAMPTZ DEFAULT NOW()
);
CREATE INDEX IF NOT EXISTS idx_jobs_status_priority ON jobs (status, priority DESC, created_at);
CREATE INDEX IF NOT EXISTS idx_jobs_heartbeat ON jobs (status, last_heartbeat_at) WHERE status = 'running';

-- ============================================================
-- Users (PostgreSQL-backed user management)
-- ============================================================
CREATE TABLE IF NOT EXISTS users (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  username VARCHAR(255) NOT NULL UNIQUE,
  password_hash TEXT NOT NULL,
  role VARCHAR(50) NOT NULL DEFAULT 'viewer',
  display_name VARCHAR(255) NOT NULL,
  active BOOLEAN NOT NULL DEFAULT TRUE,
  mfa_secret VARCHAR(255),
  created_at TIMESTAMPTZ DEFAULT NOW(),
  updated_at TIMESTAMPTZ DEFAULT NOW()
);
CREATE INDEX IF NOT EXISTS idx_users_username ON users (username);
CREATE INDEX IF NOT EXISTS idx_users_active ON users (active);

-- ============================================================
-- MFA Secrets (TOTP two-factor authentication)
-- ============================================================
CREATE TABLE IF NOT EXISTS mfa_secrets (
  username VARCHAR(255) PRIMARY KEY,
  secret VARCHAR(255) NOT NULL,
  enabled BOOLEAN DEFAULT FALSE,
  created_at TIMESTAMPTZ DEFAULT NOW()
);

-- ============================================================
-- Breach Reports (HIPAA §164.408 Breach Notification)
-- ============================================================
CREATE TABLE IF NOT EXISTS breach_reports (
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
);

-- ============================================================
-- Call Tags (user-defined labels for calls)
-- ============================================================
CREATE TABLE IF NOT EXISTS call_tags (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  call_id UUID NOT NULL REFERENCES calls(id) ON DELETE CASCADE,
  tag VARCHAR(100) NOT NULL,
  created_by VARCHAR(255) NOT NULL,
  created_at TIMESTAMPTZ DEFAULT NOW(),
  UNIQUE(call_id, tag)
);
CREATE INDEX IF NOT EXISTS idx_call_tags_call_id ON call_tags (call_id);
CREATE INDEX IF NOT EXISTS idx_call_tags_tag ON call_tags (tag);

-- ============================================================
-- Scheduled Reports (A3/F02 — periodic weekly/monthly summaries)
-- ============================================================
-- Persists generated weekly/monthly performance reports so they survive
-- restarts and so the scheduler can detect missed slots and catch up.
-- The UNIQUE(type, period_start) constraint guarantees that re-running the
-- scheduler for the same period is idempotent.
CREATE TABLE IF NOT EXISTS scheduled_reports (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  type VARCHAR(20) NOT NULL,                  -- "weekly" | "monthly"
  period_start TIMESTAMPTZ NOT NULL,
  period_end TIMESTAMPTZ NOT NULL,
  generated_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  generated_by VARCHAR(255) NOT NULL,
  data JSONB NOT NULL,
  UNIQUE (type, period_start)
);
CREATE INDEX IF NOT EXISTS idx_scheduled_reports_type_period ON scheduled_reports (type, period_start DESC);
CREATE INDEX IF NOT EXISTS idx_scheduled_reports_generated_at ON scheduled_reports (generated_at DESC);

-- ============================================================
-- Gamification Badges (A2/F01 — moved here from runMigrations)
-- ============================================================
CREATE TABLE IF NOT EXISTS badges (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  employee_id UUID NOT NULL REFERENCES employees(id) ON DELETE CASCADE,
  badge_type VARCHAR(100) NOT NULL,
  call_id UUID REFERENCES calls(id) ON DELETE SET NULL,
  earned_at TIMESTAMPTZ DEFAULT NOW(),
  metadata JSONB DEFAULT '{}'
);
CREATE INDEX IF NOT EXISTS idx_badges_employee_id ON badges (employee_id);
CREATE INDEX IF NOT EXISTS idx_badges_badge_type ON badges (badge_type);
-- Milestone badges are once-per-employee. Score/streak/sub-score badges have
-- no uniqueness constraint by design (they accumulate).
CREATE UNIQUE INDEX IF NOT EXISTS idx_badges_unique_milestone
  ON badges (employee_id, badge_type)
  WHERE badge_type IN ('first_call', 'calls_25', 'calls_50', 'calls_100');

-- ============================================================
-- Performance Snapshots (periodic reviews for employees, teams, company)
-- ============================================================
CREATE TABLE IF NOT EXISTS performance_snapshots (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  level VARCHAR(50) NOT NULL,                 -- employee | team | department | company
  target_id VARCHAR(255) NOT NULL,            -- employee UUID, team name, or "company"
  target_name VARCHAR(255) NOT NULL,          -- display name
  period_start TIMESTAMPTZ NOT NULL,
  period_end TIMESTAMPTZ NOT NULL,
  metrics JSONB NOT NULL,                     -- PerformanceMetrics object
  ai_summary TEXT,                            -- AI-generated narrative (nullable if AI unavailable)
  prior_snapshot_ids JSONB DEFAULT '[]',      -- IDs of prior snapshots used as context
  generated_by VARCHAR(255) NOT NULL,         -- username or "system" for scheduled
  generated_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
);
CREATE INDEX IF NOT EXISTS idx_snapshots_level_target ON performance_snapshots (level, target_id);
CREATE INDEX IF NOT EXISTS idx_snapshots_period ON performance_snapshots (period_end DESC);

-- ============================================================
-- Incidents (Formal Incident Response — HIPAA §164.308(a)(6))
-- ============================================================
CREATE TABLE IF NOT EXISTS incidents (
  id VARCHAR(255) PRIMARY KEY,
  title VARCHAR(500) NOT NULL,
  description TEXT NOT NULL,
  severity VARCHAR(50) NOT NULL,
  category VARCHAR(100) NOT NULL,
  current_phase VARCHAR(50) NOT NULL DEFAULT 'detection',
  declared_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  declared_by VARCHAR(255) NOT NULL,
  updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  closed_at TIMESTAMPTZ,
  affected_systems JSONB DEFAULT '[]',
  affected_users INTEGER DEFAULT 0,
  containment_actions JSONB DEFAULT '[]',
  eradication_actions JSONB DEFAULT '[]',
  recovery_actions JSONB DEFAULT '[]',
  lessons_learned TEXT,
  timeline JSONB DEFAULT '[]',
  action_items JSONB DEFAULT '[]',
  linked_breach_id VARCHAR(255),
  phi_involved BOOLEAN DEFAULT FALSE
);
CREATE INDEX IF NOT EXISTS idx_incidents_severity ON incidents (severity);
CREATE INDEX IF NOT EXISTS idx_incidents_phase ON incidents (current_phase);
CREATE INDEX IF NOT EXISTS idx_incidents_declared_at ON incidents (declared_at DESC);

-- ============================================================
-- HIPAA Audit Log (durable, never purged — 6-year retention)
-- ============================================================
CREATE TABLE IF NOT EXISTS audit_log (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  timestamp TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  event VARCHAR(100) NOT NULL,
  user_id VARCHAR(100),
  username VARCHAR(255),
  role VARCHAR(50),
  resource_type VARCHAR(50) NOT NULL,
  resource_id VARCHAR(255),
  ip VARCHAR(45),
  user_agent TEXT,
  detail TEXT
);
CREATE INDEX IF NOT EXISTS idx_audit_log_timestamp ON audit_log (timestamp);
CREATE INDEX IF NOT EXISTS idx_audit_log_user ON audit_log (username);
CREATE INDEX IF NOT EXISTS idx_audit_log_user_id ON audit_log (user_id);
CREATE INDEX IF NOT EXISTS idx_audit_log_event ON audit_log (event);
-- Note: audit_log intentionally does NOT have a FK to users.id.
-- HIPAA audit logs must be immutable and survive user deletion/renaming.
-- Both user_id and username are denormalized to preserve the audit trail.

-- Persistent state for the HMAC integrity chain (A6).
-- Single-row table; `id = 1` is the only legal row. Seeded with the genesis
-- hash on first boot so chain verification works across process restarts.
CREATE TABLE IF NOT EXISTS audit_log_integrity (
  id INTEGER PRIMARY KEY CHECK (id = 1),
  previous_hash VARCHAR(64) NOT NULL,
  updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
);
INSERT INTO audit_log_integrity (id, previous_hash)
  VALUES (1, 'genesis')
  ON CONFLICT (id) DO NOTHING;
