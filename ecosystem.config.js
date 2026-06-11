// PM2 Ecosystem Configuration
// Usage: pm2 start ecosystem.config.js
// Usage (production): pm2 start ecosystem.config.js --env production

module.exports = {
    apps: [
        {
            name: process.env.PM2_APP_NAME || 'lab-tech-studio-hub',
            script: 'server.js',
            cwd: __dirname,

            // Restart behavior
            watch: false,
            max_restarts: 10,
            restart_delay: 3000,
            min_uptime: '5s',

            // Memory threshold before auto-restart
            max_memory_restart: '512M',

            // Logs
            out_file: './logs/out.log',
            error_file: './logs/err.log',
            log_date_format: 'YYYY-MM-DD HH:mm:ss',
            merge_logs: true,

            // Environment variables
            env: {
                NODE_ENV: 'development',
                PORT: 7335
            },
            env_production: {
                NODE_ENV: 'production',
                PORT: 7335
            }
        }
    ]
};
