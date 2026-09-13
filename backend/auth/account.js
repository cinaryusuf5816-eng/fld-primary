const { transaction } = require('../db');
const { failure } = require('./users');
const { hashPassword, verifyPassword, validPassword } = require('./passwords');
const { PUBLIC_USER_FIELDS } = require('./middleware');

function onlyFields(body, fields) {
    return body && typeof body === 'object' && !Array.isArray(body) &&
        Object.keys(body).length === fields.length && Object.keys(body).every(key => fields.includes(key));
}

async function lockAccount(client, userId, tokenHash, expectedHash) {
    // Acquire the eventual write lock before a row lock. Otherwise an admin's
    // SHARE ROW EXCLUSIVE table lock can deadlock with this row's UPDATE.
    await client.query('LOCK TABLE users IN ROW EXCLUSIVE MODE');
    const result = await client.query(`SELECT password_hash FROM users
        WHERE id = $1 AND is_active = TRUE FOR UPDATE`, [userId]);
    if (!result.rows[0] || (expectedHash !== undefined && result.rows[0].password_hash !== expectedHash)) {
        throw failure(401, 'Your account or credentials have changed. Please sign in again.');
    }
    const session = await client.query(`SELECT user_id FROM auth_sessions
        WHERE token_hash = $1 AND user_id = $2 AND expires_at > CURRENT_TIMESTAMP`, [tokenHash, userId]);
    if (!session.rows[0]) throw failure(401, 'Your session is no longer active. Please sign in again.');
}

async function updateOwnProfile(pool, userId, tokenHash, body) {
    if (!onlyFields(body, ['full_name'])) throw failure(400, 'Only full_name can be updated.');
    if (typeof body.full_name !== 'string' || !body.full_name.trim() || body.full_name.trim().length > 120) {
        throw failure(400, 'Full name must contain 1–120 characters.');
    }
    return transaction(pool, async client => {
        await lockAccount(client, userId, tokenHash);
        const result = await client.query(`UPDATE users SET full_name = $1
            WHERE id = $2 AND is_active = TRUE RETURNING ${PUBLIC_USER_FIELDS}`, [body.full_name.trim(), userId]);
        return result.rows[0];
    });
}

async function changeOwnPassword(pool, userId, tokenHash, body) {
    if (!onlyFields(body, ['current_password', 'new_password'])) {
        throw failure(400, 'Only current_password and new_password are allowed.');
    }
    if (typeof body.current_password !== 'string' || !body.current_password || Buffer.byteLength(body.current_password, 'utf8') > 512) {
        throw failure(400, 'Enter your current password.');
    }
    if (!validPassword(body.new_password)) throw failure(400, 'New password must contain 12–128 characters (maximum 512 UTF-8 bytes).');
    if (body.current_password === body.new_password) throw failure(400, 'Choose a different new password.');
    const result = await pool.query('SELECT password_hash FROM users WHERE id = $1 AND is_active = TRUE', [userId]);
    const candidate = result.rows[0];
    if (!candidate) throw failure(401, 'Your account is no longer active. Please sign in again.');
    if (!await verifyPassword(body.current_password, candidate.password_hash)) throw failure(400, 'Current password is incorrect.');
    const nextHash = await hashPassword(body.new_password);
    await transaction(pool, async client => {
        // Recheck after the slow password work, under the same row lock used by
        // login. A concurrent reset or session revocation cannot be overwritten.
        await lockAccount(client, userId, tokenHash, candidate.password_hash);
        await client.query('UPDATE users SET password_hash = $1 WHERE id = $2 AND is_active = TRUE', [nextHash, userId]);
        await client.query('DELETE FROM auth_sessions WHERE user_id = $1', [userId]);
    });
}

module.exports = { updateOwnProfile, changeOwnPassword };
