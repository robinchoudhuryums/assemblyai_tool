-- CallAnalyzer PostgreSQL Schema
-- Run this once against your RDS instance to initialize the database.
-- Usage: psql $DATABASE_URL -f server/db/schema.sql

-- Enable UUID generation
CREATE EXTENSION IF NOT EXISTS "pgcrypto";

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
  uploaded_at TIMESTAMPTZ DEFAULT NOW()
);
CREATE INDEX IF NOT EXISTS idx_calls_status ON calls (status);
CREATE INDEX IF NOT EXISTS idx_calls_uploaded_at ON calls (uploaded_at DESC);
CREATE INDEX IF NOT EXISTS idx_calls_employee_id ON calls (employee_id);

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
  completed_at TIMESTAMPTZ,
  failed_reason TEXT,
  created_at TIMESTAMPTZ DEFAULT NOW(),
  updated_at TIMESTAMPTZ DEFAULT NOW()
);
CREATE INDEX IF NOT EXISTS idx_jobs_status_priority ON jobs (status, priority DESC, created_at);

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
CREATE INDEX IF NOT EXISTS idx_audit_log_event ON audit_log (event);
