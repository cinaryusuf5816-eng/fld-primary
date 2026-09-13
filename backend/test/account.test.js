const { test } = require('node:test');
const assert = require('node:assert/strict');
const { randomBytes } = require('node:crypto');
const { once } = require('node:events');
const fs = require('node:fs/promises');
const os = require('node:os');
const path = require('node:path');
const { createApp } = require('../app');
const { readConfig } = require('../config');
const { migrate } = require('../scripts/migrate');
const { createInitialAdmin, createUser, updateUser } = require('../auth/users');
const { updateOwnProfile, changeOwnPassword } = require('../auth/account');
const { hashPassword, verifyPassword } = require('../auth/passwords');
const { digest } = require('../auth/middleware');
const { testDatabase } = require('./database');

test('self-service account settings preserve roles and protect password changes', async t => {
    const database = await testDatabase();
    const { pool } = database;
    t.after(() => database.close());
    await migrate(pool);
    const password = randomBytes(24).toString('hex');
    const admin = await createInitialAdmin(pool, { email: 'settings-admin@school.test', full_name: 'Settings Admin', password });
    // Route authorization is independent of the appearance of the frontend files.
    const frontendDir = await fs.mkdtemp(path.join(os.tmpdir(), 'fld-settings-test-'));
    const files = ['settings.html', 'settings.css', 'settings.js'];
    for (const file of files) await fs.writeFile(path.join(frontendDir, file), file === 'settings.html' ? '<!doctype html><html lang="en"><title>Settings</title></html>' : '/* fixture */');
    t.after(async () => { for (const file of files) await fs.unlink(path.join(frontendDir, file)); await fs.rmdir(frontendDir); });
    const config = readConfig({ APP_ORIGINS: 'http://localhost:5500' });
    const server = createApp({ pool, config, frontendDir }).listen(0, '127.0.0.1');
    await once(server, 'listening');
    t.after(() => new Promise(resolve => { server.close(resolve); server.closeAllConnections(); }));
    const base = `http://127.0.0.1:${server.address().port}`;
    async function request(url, { method = 'GET', body, cookie, origin = 'http://localhost:5500', headers = {} } = {}) {
        const response = await fetch(base + url, { method, redirect: 'manual',
            headers: { Origin: origin, ...(cookie ? { Cookie: cookie } : {}),
                ...(body !== undefined ? { 'Content-Type': 'application/json' } : {}), ...headers },
            ...(body !== undefined ? { body: typeof body === 'string' ? body : JSON.stringify(body) } : {}) });
        const text = await response.text();
        let data; try { data = JSON.parse(text); } catch { data = text; }
        return { status: response.status, headers: response.headers, text, data };
    }
    const login = async (user, suppliedPassword = password) => {
        const response = await request('/api/auth/login', { method: 'POST', body: { email: user.email, password: suppliedPassword } });
        return { ...response, cookie: response.headers.get('set-cookie')?.split(';')[0] };
    };
    let sequence = 0;
    async function account(role = 'teacher') {
        const user = await createUser(pool, admin.id, { email: `settings-${++sequence}@school.test`, full_name: `User ${sequence}`, role, password });
        const result = await login(user);
        assert.equal(result.status, 200);
        return { user, cookie: result.cookie };
    }
    const adminCookie = (await login(admin)).cookie;
    const profiles = [{ user: admin, cookie: adminCookie }, await account('coordinator'), await account('teacher')];

    await t.test('anonymous requests cannot view Settings or modify account details', async () => {
        const page = await request('/settings.html');
        assert.equal(page.status, 302);
        assert.equal(page.headers.get('location'), '/login.html');
        assert.equal((await request('/api/auth/profile', { method: 'PATCH', body: { full_name: 'Unauthorized' } })).status, 401);
        assert.equal((await request('/api/auth/password', { method: 'POST', body: { current_password: password, new_password: randomBytes(24).toString('hex') } })).status, 401);
        for (const file of files.slice(1)) assert.equal((await request(`/${file}`)).status, 200);
    });
    await t.test('all roles can open Settings and update only their own full name', async () => {
        for (const { user, cookie } of profiles) {
            const page = await request('/settings.html', { cookie });
            assert.equal(page.status, 200);
            assert.equal(page.headers.get('cache-control'), 'no-store');
            const fullName = `Updated ${user.role}`;
            const changed = await request('/api/auth/profile', { method: 'PATCH', cookie, body: { full_name: `  ${fullName}  ` } });
            assert.equal(changed.status, 200);
            assert.equal(changed.data.authenticated, true);
            assert.equal(String(changed.data.user.id), String(user.id));
            assert.equal(changed.data.user.full_name, fullName);
            assert.equal(changed.data.user.role, user.role);
            assert.equal(changed.data.user.email, user.email);
            assert.equal(changed.headers.get('cache-control'), 'no-store');
            assert.ok(!changed.text.includes('password_hash'));
            assert.ok(!changed.text.includes(password));
            const me = await request('/api/auth/me', { cookie });
            assert.equal(me.status, 200);
            assert.equal(me.data.user.full_name, fullName);
        }
    });
    await t.test('profile rejects privilege injection, identity changes and invalid names', async () => {
        const { user, cookie } = profiles[2];
        for (const [key, value] of Object.entries({ role: 'admin', grades: ['Grade 1'], deleted_at: null, is_active: false, email: admin.email, id: admin.id, password: 'attempted password', unknown: true })) {
            const changed = await request('/api/auth/profile', { method: 'PATCH', cookie, body: { full_name: 'Attempted change', [key]: value } });
            assert.equal(changed.status, 400);
        }
        for (const body of [{}, [], null, { full_name: '' }, { full_name: '  ' }, { full_name: 1 }, { full_name: 'x'.repeat(121) }]) {
            assert.equal((await request('/api/auth/profile', { method: 'PATCH', cookie, body })).status, 400);
        }
        const me = await request('/api/auth/me', { cookie });
        assert.equal(me.data.user.full_name, 'Updated teacher');
        assert.equal(me.data.user.role, 'teacher');
        assert.equal(me.data.user.email, user.email);
        assert.equal(me.data.user.is_active, true);
        assert.equal((await request('/api/auth/profile', { method: 'PATCH', cookie, body: { full_name: 'x'.repeat(120) } })).status, 200);
    });
    await t.test('account writes retain the existing Origin and JSON CSRF protections', async () => {
        for (const [url, method, body] of [
            ['/api/auth/profile', 'PATCH', { full_name: 'Forged' }],
            ['/api/auth/password', 'POST', { current_password: password, new_password: randomBytes(24).toString('hex') }]
        ]) {
            assert.equal((await request(url, { method, cookie: adminCookie, body, origin: 'https://evil.test' })).status, 403);
            assert.equal((await request(url, { method, cookie: adminCookie, body: 'plain', headers: { 'Content-Type': 'text/plain' } })).status, 415);
        }
    });
    await t.test('invalid or incorrect password input returns 400 without logging out the user', async () => {
        const { cookie } = await account();
        const inputs = [
            { current_password: 'incorrect', new_password: randomBytes(24).toString('hex') },
            { current_password: password, new_password: password },
            { current_password: password, new_password: 'short' },
            { current_password: password, new_password: randomBytes(24).toString('hex'), role: 'admin', id: admin.id },
            { new_password: randomBytes(24).toString('hex') }
        ];
        for (const body of inputs) {
            const response = await request('/api/auth/password', { method: 'POST', cookie, body });
            assert.equal(response.status, 400);
            assert.equal(response.headers.get('set-cookie'), null);
            assert.ok(!response.text.includes(password));
            assert.equal((await request('/api/auth/me', { cookie })).status, 200);
        }
    });
    await t.test('every role can change its password and all of that user’s sessions are revoked', async () => {
        for (const role of ['admin', 'coordinator', 'teacher']) {
            const { user, cookie } = await account(role);
            const secondCookie = (await login(user)).cookie;
            const newPassword = randomBytes(24).toString('hex');
            const response = await request('/api/auth/password', { method: 'POST', cookie, body: { current_password: password, new_password: newPassword } });
            assert.equal(response.status, 200);
            assert.deepEqual(response.data, { authenticated: false });
            assert.equal(response.headers.get('cache-control'), 'no-store');
            assert.match(response.headers.get('set-cookie'), /Expires=Thu, 01 Jan 1970/);
            assert.match(response.headers.get('set-cookie'), /HttpOnly/);
            assert.ok(!response.text.includes(password));
            assert.ok(!response.text.includes(newPassword));
            assert.ok(!response.text.includes('password_hash'));
            const record = (await pool.query('SELECT password_hash, role FROM users WHERE id = $1', [user.id])).rows[0];
            assert.equal(record.role, role);
            assert.notEqual(record.password_hash, newPassword);
            assert.equal(await verifyPassword(newPassword, record.password_hash), true);
            assert.equal(Number((await pool.query('SELECT count(*) FROM auth_sessions WHERE user_id = $1', [user.id])).rows[0].count), 0);
            for (const oldCookie of [cookie, secondCookie]) assert.equal((await request('/api/auth/me', { cookie: oldCookie })).status, 401);
            assert.equal((await login(user, password)).status, 401);
            assert.equal((await login(user, newPassword)).status, 200);
            assert.equal((await request('/api/auth/me', { cookie: adminCookie })).status, 200);
        }
    });
    await t.test('password attempts are limited per user in the database and expire after 15 minutes', async () => {
        const { user, cookie } = await account();
        const newPassword = randomBytes(24).toString('hex');
        for (let i = 0; i < 5; i++) assert.equal((await request('/api/auth/password', { method: 'POST', cookie, body: { current_password: 'wrong', new_password: newPassword } })).status, 400);
        const limited = await request('/api/auth/password', { method: 'POST', cookie, body: { current_password: password, new_password: newPassword } });
        assert.equal(limited.status, 429);
        assert.equal(limited.headers.get('retry-after'), '900');
        assert.equal((await request('/api/auth/me', { cookie })).status, 200);
        const bucket = digest(`password-change:${user.id}`);
        assert.equal((await pool.query('SELECT attempts FROM auth_login_limits WHERE bucket_hash = $1', [bucket])).rows[0].attempts, 6);
        const other = await account();
        assert.equal((await request('/api/auth/password', { method: 'POST', cookie: other.cookie, body: { current_password: password, new_password: newPassword } })).status, 200);
        await pool.query("UPDATE auth_login_limits SET expires_at = CURRENT_TIMESTAMP - INTERVAL '1 second' WHERE bucket_hash = $1", [bucket]);
        assert.equal((await request('/api/auth/password', { method: 'POST', cookie, body: { current_password: password, new_password: newPassword } })).status, 200);
    });
    await t.test('concurrent password resets, deactivation and session revocation cannot be overwritten', async () => {
        const resetPassword = randomBytes(24).toString('hex');
        const resetHash = await hashPassword(resetPassword);
        for (const scenario of ['reset', 'deactivate', 'revoke']) {
            const { user, cookie } = await account();
            let intercepted = false;
            const racedPool = {
                connect: () => pool.connect(),
                query: async (sql, values) => {
                    const result = await pool.query(sql, values);
                    if (!intercepted && sql.startsWith('SELECT password_hash FROM users WHERE id = $1 AND is_active = TRUE')) {
                        intercepted = true;
                        if (scenario === 'reset') await pool.query('UPDATE users SET password_hash = $1 WHERE id = $2', [resetHash, user.id]);
                        else if (scenario === 'deactivate') await pool.query('UPDATE users SET is_active = FALSE WHERE id = $1', [user.id]);
                        else await pool.query('DELETE FROM auth_sessions WHERE user_id = $1', [user.id]);
                    }
                    return result;
                }
            };
            const proposed = randomBytes(24).toString('hex');
            await assert.rejects(changeOwnPassword(racedPool, user.id, digest(cookie.split('=')[1]), { current_password: password, new_password: proposed }), { status: 401 });
            assert.equal(intercepted, true);
            const record = (await pool.query('SELECT password_hash FROM users WHERE id = $1', [user.id])).rows[0];
            assert.equal(await verifyPassword(proposed, record.password_hash), false);
            assert.equal(await verifyPassword(scenario === 'reset' ? resetPassword : password, record.password_hash), true);
        }
    });
    await t.test('native PostgreSQL self-service updates and admin edits complete without a lock-order deadlock', {
        skip: !process.env.AUTH_TEST_DATABASE_URL && 'Requires AUTH_TEST_DATABASE_URL; PGlite serializes connections.'
    }, async () => {
        for (const operation of ['profile', 'password']) {
            const { user, cookie } = await account();
            let announceRowLock, continueSelf, adminPid;
            const rowLocked = new Promise(resolve => { announceRowLock = resolve; });
            const releaseRow = new Promise(resolve => { continueSelf = resolve; });
            const selfPool = {
                query: (sql, values) => pool.query(sql, values),
                connect: async () => {
                    const client = await pool.connect();
                    await client.query("SET lock_timeout = '5s'");
                    return {
                        query: async (sql, values) => {
                            const result = await client.query(sql, values);
                            if (sql.includes('SELECT password_hash FROM users') && sql.includes('FOR UPDATE')) {
                                announceRowLock();
                                await releaseRow;
                            }
                            return result;
                        },
                        release: () => client.release()
                    };
                }
            };
            const adminPool = {
                connect: async () => {
                    const client = await pool.connect();
                    await client.query("SET lock_timeout = '5s'");
                    adminPid = client.processID;
                    return { query: (sql, values) => client.query(sql, values), release: () => client.release() };
                }
            };
            const tokenHash = digest(cookie.split('=')[1]);
            const nextPassword = randomBytes(24).toString('hex');
            const selfChange = operation === 'profile'
                ? updateOwnProfile(selfPool, user.id, tokenHash, { full_name: 'Self change' })
                : changeOwnPassword(selfPool, user.id, tokenHash, { current_password: password, new_password: nextPassword });
            // Collect early failures too, instead of leaving rejected promises unhandled.
            const selfResult = selfChange.then(value => ({ value }), error => ({ error }));
            await Promise.race([rowLocked, selfResult.then(result => { if (result.error) throw result.error; })]);
            const adminResult = updateUser(adminPool, admin.id, user.id, { full_name: 'Admin change' })
                .then(value => ({ value }), error => ({ error }));
            let observedAdminLock = false;
            try {
                // Wait until PostgreSQL has actually received the admin's table-lock
                // request. This creates the former deadlock interleaving reliably.
                const deadline = Date.now() + 3000;
                while (Date.now() < deadline) {
                    if (adminPid) {
                        const locks = await pool.query(`SELECT granted FROM pg_locks
                            WHERE pid = $1 AND relation = 'users'::regclass AND mode = 'ShareRowExclusiveLock'`, [adminPid]);
                        if (locks.rows.length) { observedAdminLock = true; break; }
                    }
                    await new Promise(resolve => setTimeout(resolve, 10));
                }
            } finally { continueSelf(); }
            const [self, other] = await Promise.all([selfResult, adminResult]);
            assert.equal(observedAdminLock, true, 'the overlapping native lock request must be observed');
            assert.ifError(self.error);
            assert.ifError(other.error);
            const record = (await pool.query('SELECT full_name, password_hash FROM users WHERE id = $1', [user.id])).rows[0];
            assert.equal(record.full_name, 'Admin change');
            if (operation === 'password') assert.equal(await verifyPassword(nextPassword, record.password_hash), true);
        }
    });
});
