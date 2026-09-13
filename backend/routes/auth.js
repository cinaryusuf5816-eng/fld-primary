const { Router } = require('express');
const { randomBytes } = require('node:crypto');
const { verifyPassword } = require('../auth/passwords');
const { normalizeEmail } = require('../auth/users');
const { updateOwnProfile, changeOwnPassword } = require('../auth/account');
const { transaction } = require('../db');
const { digest, cookieOptions, readSessionToken, requireAuth, PUBLIC_USER_FIELDS } = require('../auth/middleware');

async function consumeLimit(pool, key, maximum) {
    const result = await pool.query(`INSERT INTO auth_login_limits (bucket_hash, attempts, expires_at)
        VALUES ($1, 1, CURRENT_TIMESTAMP + INTERVAL '15 minutes')
        ON CONFLICT (bucket_hash) DO UPDATE SET
            attempts = CASE WHEN auth_login_limits.expires_at <= CURRENT_TIMESTAMP THEN 1 ELSE auth_login_limits.attempts + 1 END,
            expires_at = CASE WHEN auth_login_limits.expires_at <= CURRENT_TIMESTAMP THEN CURRENT_TIMESTAMP + INTERVAL '15 minutes' ELSE auth_login_limits.expires_at END
        RETURNING attempts`, [digest(key)]);
    return result.rows[0].attempts <= maximum;
}

function authRoutes(pool, config) {
    const router = Router();
    router.post('/login', async (req, res) => {
        if (!await consumeLimit(pool, `ip:${req.ip}`, 60)) return res.set('Retry-After', '900').status(429).json({ error: 'Too many login attempts.' });
        const email = normalizeEmail(req.body?.email);
        const password = req.body?.password;
        if (!email || email.length > 254 || typeof password !== 'string' || !password.length || Buffer.byteLength(password, 'utf8') > 512) {
            return res.status(400).json({ error: 'Invalid login input.' });
        }
        if (!await consumeLimit(pool, `email:${email}`, 10)) return res.set('Retry-After', '900').status(429).json({ error: 'Too many login attempts.' });
        const result = await pool.query(`SELECT ${PUBLIC_USER_FIELDS}, password_hash FROM users WHERE lower(btrim(email)) = $1`, [email]);
        const candidate = result.rows[0];
        const valid = await verifyPassword(password, candidate?.password_hash);
        if (!valid || !candidate?.is_active || candidate.deleted_at) return res.status(401).json({ error: 'Invalid email or password.' });
        const token = randomBytes(32).toString('hex');
        const oldToken = readSessionToken(req, config);
        const user = await transaction(pool, async client => {
            // Lock against password/active-state changes between verification and login.
            const fresh = await client.query(`SELECT ${PUBLIC_USER_FIELDS} FROM users
                WHERE id = $1 AND password_hash = $2 AND is_active = TRUE AND deleted_at IS NULL FOR UPDATE`, [candidate.id, candidate.password_hash]);
            if (!fresh.rows[0]) return null;
            if (oldToken) await client.query('DELETE FROM auth_sessions WHERE token_hash = $1', [digest(oldToken)]);
            await client.query('INSERT INTO auth_sessions (token_hash, user_id, expires_at) VALUES ($1, $2, $3)',
                [digest(token), candidate.id, new Date(Date.now() + config.sessionMs)]);
            return fresh.rows[0];
        });
        if (!user) return res.status(401).json({ error: 'Invalid email or password.' });
        res.cookie(config.cookieName, token, { ...cookieOptions(config), maxAge: config.sessionMs });
        res.json({ authenticated: true, user });
    });
    router.get('/me', requireAuth, (req, res) => res.json({ authenticated: true, user: req.user }));
    router.patch('/profile', requireAuth, async (req, res) => {
        const user = await updateOwnProfile(pool, req.user.id, digest(readSessionToken(req, config)), req.body);
        res.json({ authenticated: true, user });
    });
    router.post('/password', requireAuth, async (req, res) => {
        if (!await consumeLimit(pool, `password-change:${req.user.id}`, 5)) {
            return res.set('Retry-After', '900').status(429).json({ error: 'Too many password change attempts. Please try again later.' });
        }
        try {
            await changeOwnPassword(pool, req.user.id, digest(readSessionToken(req, config)), req.body);
            res.clearCookie(config.cookieName, cookieOptions(config));
            res.json({ authenticated: false });
        } finally {
            if (req.body && typeof req.body === 'object') {
                if ('current_password' in req.body) req.body.current_password = '';
                if ('new_password' in req.body) req.body.new_password = '';
            }
        }
    });
    router.post('/logout', async (req, res) => {
        const token = readSessionToken(req, config);
        if (token) await pool.query('DELETE FROM auth_sessions WHERE token_hash = $1', [digest(token)]);
        res.clearCookie(config.cookieName, cookieOptions(config));
        res.json({ authenticated: false });
    });
    return router;
}
module.exports = { authRoutes };
