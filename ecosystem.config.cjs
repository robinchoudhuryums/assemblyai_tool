/**
 * PM2 Ecosystem Configuration for Blue-Green Deployment
 *
 * Two process slots: blue (port 5000) and green (port 5001).
 * Only one is active at a time — the other is built and health-checked
 * before traffic is swapped.
 *
 * Usage:
 *   pm2 start ecosystem.config.cjs --only callanalyzer-blue
 *   pm2 start ecosystem.config.cjs --only callanalyzer-green
 */
module.exports = {
  apps: [
    {
      name: "callanalyzer-blue",
      script: "dist/index.js",
      env: {
        PORT: 5000,
        NODE_ENV: "production",
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
      },
      node_args: "--max-old-space-size=1024",
      max_memory_restart: "768M",
      instances: 1,
      autorestart: true,
      watch: false,
    },
  ],
};
