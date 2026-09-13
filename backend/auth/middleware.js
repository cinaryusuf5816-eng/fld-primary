const { createHash } = require('node:crypto');
const ROLES = Object.freeze(['admin', 'coordinator', 'teacher']);
const PUBLIC_USER_FIELDS = 'id, email, full_name, role, grades, is_active, deleted_at, created_at, updated_at';
const digest = token => createHash('sha256').update(token).digest('hex');

function readSessionToken(req, config) {
    const matches = (req.headers.cookie || '').split(';').map(part => part.trim())
        .filter(part => part.startsWith(`${config.cookieName}=`));
    if (matches.length !== 1) return null;
    const token = matches[0].slice(config.cookieName.length + 1);
    return /^[a-f0-9]{64}$/.test(token) ? token : null;
}

function cookieOptions(config) {
    return { httpOnly: true, secure: config.production, sameSite: 'lax', path: '/' };
}

function loadSession(pool, config) {
    return async (req, res, next) => {
        req.user = null;
        const token = readSessionToken(req, config);
        if (token) {
            const result = await pool.query(`
                SELECT u.id, u.email, u.full_name, u.role, u.grades, u.is_active, u.deleted_at, u.created_at, u.updated_at
                FROM auth_sessions s JOIN users u ON u.id = s.user_id
                WHERE s.token_hash = $1 AND s.expires_at > CURRENT_TIMESTAMP AND u.is_active = TRUE AND u.deleted_at IS NULL`,
            [digest(token)]);
            if (result.rows[0] && ROLES.includes(result.rows[0].role)) req.user = result.rows[0];
        }
        next();
    };
}

function requireAuth(req, res, next) {
    if (!req.user || !req.user.is_active || req.user.deleted_at) return res.status(401).json({ error: 'Authentication required.' });
    next();
}

function requireRoles(...roles) {
    if (!roles.length || roles.some(role => !ROLES.includes(role))) throw new Error('Unknown authorization role.');
    return (req, res, next) => requireAuth(req, res, () => {
        if (!roles.includes(req.user.role)) return res.status(403).json({ error: 'Access denied.' });
        next();
    });
}

module.exports = { ROLES, PUBLIC_USER_FIELDS, digest, readSessionToken, cookieOptions, loadSession, requireAuth, requireRoles };
