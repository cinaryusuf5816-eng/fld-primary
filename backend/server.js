const { createPool } = require('./db');
const { readConfig } = require('./config');
const { createApp } = require('./app');

const config = readConfig();
const pool = createPool();
pool.on('error', () => console.error('Database pool connection error.'));
const app = createApp({ pool, config });
const server = app.listen(config.port, process.env.HOST || '127.0.0.1', () => {
    console.log(`FLD Backend is running on port ${config.port}.`);
});
const cleanup = setInterval(async () => {
    try {
        await pool.query('DELETE FROM auth_sessions WHERE expires_at <= CURRENT_TIMESTAMP');
        await pool.query('DELETE FROM auth_login_limits WHERE expires_at <= CURRENT_TIMESTAMP');
    } catch { console.error('Auth cleanup failed. Check database setup.'); }
}, 15 * 60 * 1000);
cleanup.unref();
for (const signal of ['SIGINT', 'SIGTERM']) process.once(signal, () => {
    clearInterval(cleanup);
    server.close(() => pool.end());
});
