// ecosystem.config.cjs
// PM2 process manager configuration for ECODrIx Backend.
//
// Usage:
//   pm2 start ecosystem.config.cjs --env production
//   pm2 reload ecodrix-backend   (zero-downtime deploy)
//   pm2 save && pm2 startup       (auto-start on reboot)
//
// IMPORTANT: Do NOT set instances > 1 without adding a Redis adapter
// to Socket.IO. The MongoQueue worker runs in-process. Multiple instances
// will cause duplicate job execution.

module.exports = {
  apps: [
    {
      name: "ecodrix-backend",
      script: "./dist/server.js",

      // Single process — required for Socket.IO + MongoQueue in-process worker
      instances: 1,
      exec_mode: "fork",

      // Environment
      env_production: {
        NODE_ENV: "production",
        PORT: 4000,
      },
      env_development: {
        NODE_ENV: "development",
        PORT: 4000,
      },

      // Logs
      error_file: "./logs/err.log",
      out_file: "./logs/out.log",
      log_date_format: "YYYY-MM-DD HH:mm:ss Z",
      merge_logs: true,

      // Auto-restart behaviour
      watch: false, // never watch in production — use pm2 reload instead
      restart_delay: 3000, // 3s delay between restarts
      max_restarts: 10, // stop restarting after 10 rapid failures
      min_uptime: "10s", // must stay up ≥10s to count as a successful start

      // Memory limit — restart if the process grows above this
      max_memory_restart: "512M",

      // Graceful shutdown — matches the SIGTERM handler in server.ts
      kill_timeout: 12000, // 12s (server.ts forces exit after 10s; PM2 adds 2s buffer)
      listen_timeout: 15000,

      // Node.js flags
      node_args: "--max-old-space-size=512",
    },
  ],
};
