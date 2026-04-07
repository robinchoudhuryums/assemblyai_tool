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
 */
const RDS_CA_BUNDLE = "/home/ec2-user/global-bundle.pem";

module.exports = {
  apps: [
    {
      name: "callanalyzer",
      script: "dist/index.js",
      env: {
        NODE_ENV: "production",
        NODE_EXTRA_CA_CERTS: RDS_CA_BUNDLE,
      },
      node_args: "--max-old-space-size=1024",
      max_memory_restart: "768M",
      instances: 1,
      autorestart: true,
      watch: false,
    },
    {
      name: "callanalyzer-blue",
      script: "dist/index.js",
      env: {
        PORT: 5000,
        NODE_ENV: "production",
        NODE_EXTRA_CA_CERTS: RDS_CA_BUNDLE,
      },
      node_args: "--max-old-space-size=1024",
      max_memory_restart: "768M",
      instances: 1,
      autorestart: true,
      watch: false,
    },
    {
      name: "callanalyzer-green",
      script: "dist/index.js",
      env: {
        PORT: 5001,
        NODE_ENV: "production",
        NODE_EXTRA_CA_CERTS: RDS_CA_BUNDLE,
      },
      node_args: "--max-old-space-size=1024",
      max_memory_restart: "768M",
      instances: 1,
      autorestart: true,
      watch: false,
    },
  ],
};
