const { transaction } = require('../db');
const { ROLES, PUBLIC_USER_FIELDS } = require('./middleware');
const { hashPassword, validPassword } = require('./passwords');
const { normalizeGrades } = require('./grades');

function failure(status, message) { return Object.assign(new Error(message), { status }); }
function normalizeEmail(value) { return typeof value === 'string' ? value.trim().toLowerCase() : ''; }
function validateUser(body, partial = false) {
    if (!body || typeof body !== 'object' || Array.isArray(body)) throw failure(400, 'Expected a JSON object.');
    const allowed = ['email', 'full_name', 'password', 'role', 'is_active', 'grades'];
    if (Object.keys(body).some(key => !allowed.includes(key))) throw failure(400, 'Unknown user field.');
    if (partial && !Object.keys(body).length) throw failure(400, 'No changes provided.');
    if ((!partial || 'email' in body) && (!/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(normalizeEmail(body.email)) || normalizeEmail(body.email).length > 254)) throw failure(400, 'Invalid email.');
    if ((!partial || 'full_name' in body) && (typeof body.full_name !== 'string' || !body.full_name.trim() || body.full_name.trim().length > 120)) throw failure(400, 'Invalid full_name.');
    if ((!partial || 'password' in body) && !validPassword(body.password)) throw failure(400, 'Password must contain 12–128 characters (maximum 512 UTF-8 bytes).');
    if ('role' in body && !ROLES.includes(body.role)) throw failure(400, 'Invalid role.');
    if ('is_active' in body && typeof body.is_active !== 'boolean') throw failure(400, 'is_active must be boolean.');
    if ('grades' in body) normalizeGrades(body.grades);
}

async function insertUser(client, body, passwordHash) {
    const result = await client.query(`INSERT INTO users (email, full_name, password_hash, role, is_active, grades)
        VALUES ($1, $2, $3, $4, $5, $6) RETURNING ${PUBLIC_USER_FIELDS}`,
    [normalizeEmail(body.email), body.full_name.trim(), passwordHash, body.role || 'teacher', body.is_active ?? true, normalizeGrades(body.grades ?? [])]);
    return result.rows[0];
}

// Serialize account changes and recheck the actor inside the transaction.
async function adminTransaction(pool, actorId, action) {
    return transaction(pool, async client => {
        await client.query('LOCK TABLE users IN SHARE ROW EXCLUSIVE MODE');
        const actor = await client.query('SELECT role, is_active FROM users WHERE id = $1 AND deleted_at IS NULL', [actorId]);
        if (!actor.rows[0]?.is_active || actor.rows[0].role !== 'admin') throw failure(403, 'Access denied.');
        return action(client);
    });
}

async function createUser(pool, actorId, body) {
    validateUser(body);
    const hash = await hashPassword(body.password);
    return adminTransaction(pool, actorId, client => insertUser(client, body, hash));
}

async function updateUser(pool, actorId, id, body) {
    validateUser(body, true);
    const hash = 'password' in body ? await hashPassword(body.password) : null;
    return adminTransaction(pool, actorId, async client => {
        const result = await client.query('SELECT id, role, is_active FROM users WHERE id = $1 AND deleted_at IS NULL', [id]);
        const current = result.rows[0];
        if (!current) throw failure(404, 'User not found.');
        if (current.role === 'admin' && current.is_active &&
            (('role' in body && body.role !== 'admin') || body.is_active === false)) {
            const admins = await client.query("SELECT id FROM users WHERE role = 'admin' AND is_active = TRUE");
            if (admins.rows.length <= 1) throw failure(409, 'The last active admin cannot be disabled or demoted.');
        }
        const fields = [], values = [];
        for (const key of ['email', 'full_name', 'role', 'is_active', 'grades']) {
            if (!(key in body)) continue;
            values.push(key === 'email' ? normalizeEmail(body[key]) : key === 'full_name' ? body[key].trim() : key === 'grades' ? normalizeGrades(body[key]) : body[key]);
            fields.push(`${key} = $${values.length}`);
        }
        if (hash) { values.push(hash); fields.push(`password_hash = $${values.length}`); }
        values.push(id);
        const updated = await client.query(`UPDATE users SET ${fields.join(', ')} WHERE id = $${values.length} RETURNING ${PUBLIC_USER_FIELDS}`, values);
        if (hash || 'role' in body || 'is_active' in body || 'grades' in body) await client.query('DELETE FROM auth_sessions WHERE user_id = $1', [id]);
        return updated.rows[0];
    });
}

async function removeUser(pool, actorId, id) {
    return adminTransaction(pool, actorId, async client => {
        const current = (await client.query('SELECT id, role, is_active FROM users WHERE id=$1 AND deleted_at IS NULL', [id])).rows[0];
        if (!current) throw failure(404, 'User not found.');
        if (current.role === 'admin' && current.is_active) {
            const admins = await client.query("SELECT id FROM users WHERE role='admin' AND is_active=TRUE AND deleted_at IS NULL");
            if (admins.rows.length <= 1) throw failure(409, 'The last active admin cannot be removed.');
        }
        const removed = await client.query(`UPDATE users SET is_active=FALSE, deleted_at=clock_timestamp()
            WHERE id=$1 RETURNING ${PUBLIC_USER_FIELDS}`, [id]);
        await client.query('DELETE FROM auth_sessions WHERE user_id=$1', [id]);
        return removed.rows[0];
    });
}

async function createInitialAdmin(pool, body) {
    validateUser({ ...body, role: 'admin', is_active: true });
    const hash = await hashPassword(body.password);
    return transaction(pool, async client => {
        await client.query('LOCK TABLE users IN SHARE ROW EXCLUSIVE MODE');
        const existing = await client.query("SELECT id FROM users WHERE role = 'admin' LIMIT 1");
        if (existing.rows.length) throw failure(409, 'An admin already exists. Use an authenticated admin to manage users.');
        return insertUser(client, { ...body, role: 'admin', is_active: true }, hash);
    });
}

module.exports = { failure, normalizeEmail, createUser, updateUser, removeUser, createInitialAdmin };
