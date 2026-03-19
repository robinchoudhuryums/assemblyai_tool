# CallAnalyzer — HIPAA Security Summary

**Purpose**: This document maps HIPAA safeguards to specific code and infrastructure controls, enabling IT review and compliance verification.

**Last Updated**: 2026-03-19

---

## 1. Data Flow Overview

```
User (Browser) ──HTTPS/TLS──> Caddy (port 443) ──> Node.js (port 5000)
                                                        │
                                    ┌───────────────────┼───────────────────┐
                                    ▼                   ▼                   ▼
                              AWS S3 (KMS)       AssemblyAI API      AWS Bedrock
                              (storage)          (transcription)     (AI analysis)
```

- **All external connections use HTTPS/TLS**
- **PHI locations**: S3 bucket (audio, transcripts, analysis), in-transit to AssemblyAI and Bedrock
- **No PHI is stored on the EC2 filesystem** — uploaded files are cleaned up after S3 upload

---

## 2. Access Controls

| Safeguard | Implementation | Code Location |
|-----------|---------------|---------------|
| **Authentication** | Session-based with hashed passwords (scrypt + salt) | `server/auth.ts:60-71` |
| **Role-based access** | 3-tier hierarchy (viewer < manager < admin) enforced via `requireRole()` middleware | `server/auth.ts:246-267` |
| **Account lockout** | 5 failed attempts → 15-minute lockout per IP and username | `server/auth.ts:12-41` |
| **Session idle timeout** | 15-minute idle timeout (rolling) | `server/auth.ts:133-134` |
| **Session absolute timeout** | 8-hour maximum session lifetime | `server/auth.ts:135` |
| **Secure cookies** | `httpOnly`, `sameSite=lax`, `secure` in production | `server/auth.ts:144-149` |
| **WebSocket auth** | Upgrade requests verified via session cookie + passport | `server/services/websocket.ts:37-59` |
| **Login rate limiting** | 5 attempts per 15 minutes per IP | `server/index.ts:103` |

### Role Permissions

| Role | Read Data | Upload Calls | Manage Employees | Edit Analysis | Admin Functions |
|------|-----------|-------------|------------------|--------------|-----------------|
| viewer | Yes | Yes | No | No | No |
| manager | Yes | Yes | Yes | Yes | No |
| admin | Yes | Yes | Yes | Yes | Yes |

---

## 3. Encryption

| Layer | Method | Details |
|-------|--------|---------|
| **In transit** | TLS 1.2+ via Caddy (Let's Encrypt) | Auto-renewed certificates for `umscallanalyzer.com` |
| **At rest (S3)** | AWS KMS (SSE-KMS) with bucket keys | `aws s3api get-bucket-encryption --bucket ums-call-archive` to verify |
| **HTTPS enforcement** | HTTP → HTTPS redirect in production | `server/index.ts:43-54` |
| **HSTS** | `Strict-Transport-Security: max-age=31536000; includeSubDomains` | `server/index.ts:64` |

---

## 4. Audit Controls

| Safeguard | Implementation | Code Location |
|-----------|---------------|---------------|
| **API access logging** | All API calls logged with: user identity, method, path, status code, duration | `server/index.ts:79-95` |
| **PHI access audit** | Structured `[HIPAA_AUDIT]` JSON logs for all PHI access events (user, resource type, timestamps) | `server/services/audit-log.ts:24-31` |
| **AWS CloudTrail** | Trail `ums-analyzer-trail` logs all AWS API calls (S3, Bedrock, IAM) | AWS Console → CloudTrail |
| **Error logging** | Only error messages logged — no full stack traces (prevents PHI leakage) | `server/routes.ts:727` |
| **S3 bucket versioning** | Enabled — protects against accidental overwrites/deletes | `aws s3api get-bucket-versioning --bucket ums-call-archive` to verify |

**Log format example**:
```
[AUDIT] 2026-03-10T13:02:25.709Z robin(admin) GET /api/employees 200 2443ms
```

---

## 5. Network Security

| Safeguard | Implementation | How to Verify |
|-----------|---------------|---------------|
| **TLS termination** | Caddy reverse proxy with auto-TLS | `curl -sI https://umscallanalyzer.com` |
| **CSP headers** | Restricts scripts to same-origin only (no `unsafe-inline`), fonts to Google Fonts | `server/index.ts:68-70` |
| **Frame protection** | `X-Frame-Options: DENY` + `frame-ancestors 'none'` | `server/index.ts:62` |
| **Content sniffing** | `X-Content-Type-Options: nosniff` | `server/index.ts:61` |
| **Referrer policy** | `strict-origin-when-cross-origin` | `server/index.ts:65` |
| **Permissions policy** | Camera, microphone, geolocation all disabled | `server/index.ts:66` |
| **API caching** | `no-store, no-cache` on all `/api` responses | `server/index.ts:72-75` |
| **VPC endpoints** | (Recommended) S3 Gateway + Bedrock PrivateLink endpoints route AWS API traffic through private network, avoiding public internet for PHI | See [`docs/vpc-endpoints.md`](docs/vpc-endpoints.md) |
| **WAF** | Application-level firewall: SQL injection, XSS, path traversal detection; IP blocklist with anomaly scoring; suspicious bot blocking | `server/middleware/waf.ts` |
| **Vulnerability scanning** | Automated daily scans: environment config, dependencies (npm audit), database security, auth config, security headers | `server/services/vulnerability-scanner.ts` |

---

## 5b. Incident Response

| Safeguard | Implementation | Code Location |
|-----------|---------------|---------------|
| **Formal IRP** | Structured incident lifecycle: detection → triage → containment → eradication → recovery → post-incident → closed | `server/services/incident-response.ts` |
| **Incident classification** | 4-tier severity (P1-critical through P4-low) with 10 category types | `server/services/incident-response.ts` |
| **Escalation procedures** | Configurable escalation contacts with severity-based notification rules | `GET /api/admin/incident-response-plan` |
| **Response procedures** | Step-by-step playbook for each incident phase with time targets | `RESPONSE_PROCEDURES` in incident-response.ts |
| **Timeline tracking** | Every action logged with timestamp, actor, phase, and automated flag | `Incident.timeline` array |
| **Action items** | Post-incident review action items with assignee, due date, and status tracking | `Incident.actionItems` array |
| **PHI tracking** | Each incident tracks whether PHI was involved and links to breach reports | `Incident.phiInvolved`, `Incident.linkedBreachId` |
| **Database persistence** | Incidents persisted to PostgreSQL `incidents` table (falls back to in-memory) | `server/db/schema.sql` |
| **Disaster recovery** | Documented DR plan with S3 CRR, RDS cross-region replica, AMI snapshots, DNS failover | [`docs/disaster-recovery.md`](docs/disaster-recovery.md) |

---

## 6. Data Retention & Disposal

| Safeguard | Implementation | Code Location |
|-----------|---------------|---------------|
| **Auto-purge** | Calls older than `RETENTION_DAYS` (default: 90) automatically deleted | `server/index.ts:145-162` |
| **Purge scope** | Deletes call record, audio file, transcript, sentiment, and analysis from S3 | `server/storage.ts` (CloudStorage.purgeExpiredCalls) |
| **Purge schedule** | Runs on startup (30s delay) and every 24 hours | `server/index.ts:150-160` |
| **Upload cleanup** | Temporary uploaded files removed from EC2 after S3 upload | `server/routes.ts` (processAudioFile) |

---

## 7. Third-Party Services

| Service | Purpose | HIPAA Status | BAA Required |
|---------|---------|-------------|-------------|
| **AWS S3** | Audio, transcript, analysis storage | HIPAA-eligible | Yes — via AWS Artifact |
| **AWS Bedrock** | AI analysis of transcripts (Claude) | HIPAA-eligible | Yes — covered by AWS BAA |
| **AWS KMS** | S3 encryption key management | HIPAA-eligible | Yes — covered by AWS BAA |
| **AssemblyAI** | Audio transcription | Check with vendor | Yes — contact AssemblyAI |
| **Caddy** | TLS/reverse proxy (runs on EC2) | N/A (local software) | N/A |

---

## 8. Infrastructure

| Component | Details |
|-----------|---------|
| **EC2 instance** | Amazon Linux, managed with pm2 |
| **Reverse proxy** | Caddy (auto-TLS, ports 80/443 → localhost:5000) |
| **S3 bucket** | `ums-call-archive`, KMS encryption, versioning enabled |
| **CloudTrail** | `ums-analyzer-trail` — logs AWS API activity |
| **IAM** | Shared IAM user across CallAnalyzer, RAG Tool, PMD Questionnaire |
| **Domain** | `umscallanalyzer.com` with Let's Encrypt TLS |

---

## 9. Verification Commands

Run these on the EC2 instance or locally with AWS CLI to verify controls:

```bash
# Verify S3 encryption
aws s3api get-bucket-encryption --bucket ums-call-archive

# Verify S3 versioning
aws s3api get-bucket-versioning --bucket ums-call-archive

# Verify S3 public access block
aws s3api get-public-access-block --bucket ums-call-archive

# Verify TLS
curl -sI https://umscallanalyzer.com | head -15

# Verify health endpoint
curl -s https://umscallanalyzer.com/api/health

# Check CloudTrail status
aws cloudtrail get-trail-status --name ums-analyzer-trail

# View recent audit logs
pm2 logs callanalyzer --lines 50 | grep AUDIT

# View HIPAA audit events
pm2 logs callanalyzer --lines 100 | grep HIPAA_AUDIT
```

---

## 10. Known Limitations & Recommendations

| Item | Current State | Recommendation |
|------|--------------|----------------|
| **IAM user** | Shared across 3 projects with long-lived access keys | Consider separate IAM users per project, or use IAM roles with EC2 instance profiles |
| **Auth backend** | Environment-variable-based users (`AUTH_USERS`) | Works for small teams; for larger orgs, consider an IdP (Cognito, Okta) with MFA |
| **WAF** | Application-level WAF implemented (IP blocking, SQLi/XSS/path traversal detection, anomaly scoring); consider adding AWS WAF at edge (CloudFront/ALB) for defense-in-depth | Optionally add AWS WAF rules for DDoS protection at the edge |
| **VPC endpoints** | S3/Bedrock accessed over public internet | Configure VPC endpoints for S3 (free Gateway endpoint) and Bedrock (Interface/PrivateLink) to route PHI traffic through AWS private network instead of the public internet. See [`docs/vpc-endpoints.md`](docs/vpc-endpoints.md) for step-by-step setup |
| **Backup** | S3 versioning enabled; DR plan documented with CRR, RDS replica, and AMI snapshots | Follow [`docs/disaster-recovery.md`](docs/disaster-recovery.md) to implement cross-region replication |
| **App MFA** | TOTP MFA implemented (`server/services/totp.ts`) but optional by default | Set `REQUIRE_MFA=true` to enforce for all users; consider enforcing for admin accounts at minimum |
| **IAM MFA** | Not enforced on the shared IAM user | Enable MFA on the IAM user via AWS Console |
