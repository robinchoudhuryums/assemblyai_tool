/**
 * PM2 Ecosystem Configuration
 *
 * Three process entries:
 *   - callanalyzer          : the standard single-slot production process
 *   - callanalyzer-blue     : blue slot for blue-green deployment (port 5000)
 *   - callanalyzer-green    : green slot for blue-green deployment (port 5001)
 *
 * Usage:
 *   pm2 start ecosystem.config.cjs --only callanalyzer
 *   pm2 start ecosystem.config.cjs --only callanalyzer-blue
 *   pm2 start ecosystem.config.cjs --only callanalyzer-green
 *
 * NODE_EXTRA_CA_CERTS: points Node at the AWS RDS global CA bundle so the
 * pg pool (which enforces rejectUnauthorized: true in production) can
 * validate the RDS certificate chain. The file must be downloaded from
 * https://truststore.pki.rds.amazonaws.com/global/global-bundle.pem on the
 * EC2 host. This env var MUST be set in the process environment (pm2 env
 * block), NOT in .env — Node reads it at startup before dotenv runs.
 *
 * exec_mode: "fork" is REQUIRED — pm2 cluster mode (the default when
 * `instances` is set) does NOT propagate env-block variables to workers
 * reliably. Confirmed empirically via /proc/<pid>/environ: cluster workers
 * had only PATH + cluster IPC vars; fork workers have the full env block.
 * Do not change this to "cluster" without first verifying NODE_EXTRA_CA_CERTS
 * still reaches the worker process.
 *
 * kill_timeout: 35000 (ms) is REQUIRED to give server/index.ts gracefulShutdown
 * room to run. The default pm2 kill_timeout is 1600ms, which SIGKILLs the
 * process before:
 *   - all seven scheduler stop functions complete (INV-29)
 *   - jobQueue.stop() drains in-flight pipeline jobs (20s budget per INV-09)
 *   - persistIntegrityChainHead() writes the audit HMAC head to DB
 *   - flushAuditQueue() drains the per-row audit write queue (10s budget)
 *   - the pg pool closes cleanly
 * The graceful shutdown sequence has a 30s outer hard-exit; 35s gives a 5s
 * safety margin for pm2 to observe the natural exit before sending SIGKILL.
 */
const RDS_CA_BUNDLE = "/home/ec2-user/global-bundle.pem";

module.exports = {
  apps: [
    {
      name: "callanalyzer",
      script: "dist/index.js",
      exec_mode: "fork",
      env: {
        NODE_ENV: "production",
        NODE_EXTRA_CA_CERTS: RDS_CA_BUNDLE,
      },
      node_args: "--max-old-space-size=1024",
      max_memory_restart: "768M",
      autorestart: true,
      watch: false,
      kill_timeout: 35000,
    },
    {
      name: "callanalyzer-blue",
      script: "dist/index.js",
      exec_mode: "fork",
      env: {
        PORT: 5000,
        NODE_ENV: "production",
        NODE_EXTRA_CA_CERTS: RDS_CA_BUNDLE,
      },
      node_args: "--max-old-space-size=1024",
      max_memory_restart: "768M",
      autorestart: true,
      watch: false,
      kill_timeout: 35000,
    },
    {
      name: "callanalyzer-green",
      script: "dist/index.js",
      exec_mode: "fork",
      env: {
        PORT: 5001,
        NODE_ENV: "production",
        NODE_EXTRA_CA_CERTS: RDS_CA_BUNDLE,
      },
      node_args: "--max-old-space-size=1024",
      max_memory_restart: "768M",
      autorestart: true,
      watch: false,
      kill_timeout: 35000,
    },
  ],
};
