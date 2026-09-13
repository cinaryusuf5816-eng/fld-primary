const express = require('express');
const cors = require('cors');
const path = require('node:path');
const { readConfig } = require('./config');
const { loadSession, requireAuth, requireRoles } = require('./auth/middleware');
const { authRoutes } = require('./routes/auth');
const { userRoutes } = require('./routes/users');
const { eventRoutes } = require('./routes/events');
const { academicRoutes } = require('./routes/academic');
const { materialRoutes } = require('./routes/materials');
const { announcementRoutes } = require('./routes/announcements');
const { archiveRoutes } = require('./routes/archive');

function createApp({ pool, config = readConfig(), frontendDir = path.join(__dirname, '..') }) {
    const app = express();
    app.disable('x-powered-by');
    app.set('trust proxy', config.trustProxy);
    app.use((req, res, next) => {
        res.set('X-Content-Type-Options', 'nosniff');
        res.set('Referrer-Policy', 'same-origin');
        next();
    });
    app.use('/api', (req, res, next) => {
        res.set('Cache-Control', 'no-store');
        if (config.production && !req.secure) return res.status(400).json({ error: 'HTTPS is required.' });
        const origin = req.get('Origin');
        if (origin && !config.origins.includes(origin)) return res.status(403).json({ error: 'Origin is not allowed.' });
        if (!['GET', 'HEAD', 'OPTIONS'].includes(req.method)) {
            // JSON-only writes plus an exact Origin allowlist prevent browser CSRF.
            if (!req.is('application/json')) return res.status(415).json({ error: 'Use application/json.' });
            if (!origin && req.get('Sec-Fetch-Site') === 'cross-site') return res.status(403).json({ error: 'Cross-site request denied.' });
        }
        next();
    });
    app.use('/api', cors({ origin: config.origins, credentials: true, methods: ['GET', 'POST', 'PATCH', 'PUT', 'DELETE', 'OPTIONS'], allowedHeaders: ['Content-Type', 'Accept'] }));
    app.use('/api', loadSession(pool, config));
    // File uploads stay JSON/Origin protected, and authenticate before buffering.
    app.post(['/api/materials', '/api/archive'], requireAuth, express.json({ limit: '14mb' }));
    app.use('/api/homework/:id/checks', express.json({ limit: '256kb' }));
    app.use('/api', express.json({ limit: '16kb' }));
    app.use('/api/auth', authRoutes(pool, config));
    app.use('/api/users', userRoutes(pool));
    app.use('/api/events', eventRoutes(pool, config));
    app.use('/api/materials', materialRoutes(pool, config));
    app.use('/api/archive', archiveRoutes(pool, config));
    app.use('/api/announcements', announcementRoutes(pool, config));
    app.use('/api', academicRoutes(pool, config));
    app.use('/api', (req, res) => res.status(404).json({ error: 'Route not found.' }));

    // Explicit files only: never expose backend source, .env, SQL or package files.
    const publicFiles = ['login.html', 'login.css', 'login.js', 'auth.js', 'confirm.js', 'logo.png', 'styles.css',
        'script.js', 'sidebar.js', 'calendar.js', 'materials.js', 'homework.js', 'announcements.js', 'users.css', 'users.js',
        'settings.css', 'settings.js', 'dashboard.css', 'portal-data.js', 'homework-report.js', 'homework.css', 'homework-check.js', 'materials.css', 'announcements.css', 'archive.css', 'archive.js', 'page-theme.css', 'calendar.css'];
    for (const file of publicFiles) app.get(`/${file}`, (req, res) => res.sendFile(path.join(frontendDir, file)));
    const pages = ['index.html', 'calendar.html', 'materials.html', 'homework.html', 'homework-check.html', 'announcements.html', 'sidebar.html', 'topbar.html', 'settings.html', 'archive.html'];
    for (const file of pages) app.get(file === 'index.html' ? ['/', '/index.html'] : `/${file}`, loadSession(pool, config),
        (req, res, next) => req.user ? next() : res.redirect('/login.html'), requireAuth,
        (req, res) => { res.set('Cache-Control', 'no-store'); res.sendFile(path.join(frontendDir, file)); });
    app.get('/users.html',
        (req, res, next) => { res.set('Cache-Control', 'no-store'); next(); },
        loadSession(pool, config),
        (req, res, next) => req.user ? next() : res.redirect('/login.html'),
        requireRoles('admin'),
        (req, res) => res.sendFile(path.join(frontendDir, 'users.html')));
    app.use((error, req, res, next) => {
        if (res.headersSent) return next(error);
        if (error.code === '23505') return res.status(409).json({ error: 'Email already exists.' });
        if (['22P02', '22007', '22008', '23502', '23514', '22003'].includes(error.code)) return res.status(400).json({ error: 'Invalid input.' });
        if (error.type === 'entity.too.large') return res.status(413).json({ error: 'Request too large.' });
        if (error.type === 'entity.parse.failed') return res.status(400).json({ error: 'Invalid JSON.' });
        if (error.status && error.status < 500) return res.status(error.status).json({ error: error.message });
        // Never log request bodies, cookies, query parameters or database error detail.
        console.error('Request failed:', error.code || 'INTERNAL_ERROR');
        res.status(500).json({ error: 'The request could not be completed.' });
    });
    return app;
}
module.exports = { createApp };
