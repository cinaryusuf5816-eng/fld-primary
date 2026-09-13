const { test } = require('node:test');
const assert = require('node:assert/strict');
const { randomBytes } = require('node:crypto');
const { once } = require('node:events');
const { createApp } = require('../app');
const { readConfig } = require('../config');
const { migrate } = require('../scripts/migrate');
const { createInitialAdmin } = require('../auth/users');
const { hashPassword, verifyPassword } = require('../auth/passwords');
const { digest, requireRoles } = require('../auth/middleware');
const { testDatabase } = require('./database');

test('authentication, authorization and existing calendar integration', async t => {
    const database = await testDatabase();
    const { pool } = database;
    t.after(() => database.close());
    await pool.query(`CREATE TABLE events (
        id SERIAL PRIMARY KEY, created_at TIMESTAMPTZ DEFAULT CURRENT_TIMESTAMP,
        title TEXT NOT NULL, start_date DATE NOT NULL, end_date DATE NOT NULL,
        start_time TIME, end_time TIME, category TEXT, description TEXT, days JSONB
    ); INSERT INTO events (title, start_date, end_date, category) VALUES ('Existing event', '2026-09-12', '2026-09-12', 'activity')`);
    await t.test('migration is repeatable and leaves existing events intact', async () => {
        assert.deepEqual(await migrate(pool), ['001_auth.sql', '002_calendar_schema.sql', '003_academic.sql', '004_grade_access.sql', '005_library.sql', '006_announcements.sql', '007_homework_pages.sql', '008_school_archive.sql', '009_archive_folders.sql', '010_material_file_cleanup.sql', '011_material_authorship.sql']);
        assert.deepEqual(await migrate(pool), []);
        assert.equal(Number((await pool.query('SELECT count(*) FROM events')).rows[0].count), 1);
    });
    const password = randomBytes(24).toString('hex');
    let admin;
    await t.test('bootstrap stores only a salted hash and refuses a second admin', async () => {
        admin = await createInitialAdmin(pool, { email: 'Admin@school.test', full_name: 'Admin', password });
        assert.equal(admin.email, 'admin@school.test');
        assert.equal(admin.role, 'admin');
        assert.ok(!('password_hash' in admin));
        const record = (await pool.query('SELECT password_hash FROM users WHERE id = $1', [admin.id])).rows[0];
        assert.notEqual(record.password_hash, password);
        assert.ok(!record.password_hash.includes(password));
        assert.equal(await verifyPassword(password, record.password_hash), true);
        assert.equal(await verifyPassword('incorrect', record.password_hash), false);
        assert.equal(await verifyPassword(password, 'malformed'), false);
        assert.notEqual(await hashPassword(password), record.password_hash);
        await assert.rejects(createInitialAdmin(pool, { email: 'second@school.test', full_name: 'Second', password }), { status: 409 });
    });
    const config = readConfig({ APP_ORIGINS: 'http://localhost:5500' });
    const server = createApp({ pool, config }).listen(0, '127.0.0.1');
    await once(server, 'listening');
    t.after(() => new Promise(resolve => { server.close(resolve); server.closeAllConnections(); }));
    const base = `http://127.0.0.1:${server.address().port}`;
    async function request(url, { method = 'GET', body, cookie, origin = 'http://localhost:5500', headers = {} } = {}) {
        const response = await fetch(base + url, { method, redirect: 'manual',
            headers: { ...(origin ? { Origin: origin } : {}), ...(cookie ? { Cookie: cookie } : {}),
                ...(body !== undefined ? { 'Content-Type': 'application/json' } : {}), ...headers },
            ...(body !== undefined ? { body: typeof body === 'string' ? body : JSON.stringify(body) } : {}) });
        const text = await response.text();
        let data; try { data = JSON.parse(text); } catch { data = text; }
        return { status: response.status, headers: response.headers, data, text };
    }
    const login = async (email, suppliedPassword = password, extra = {}) => {
        const result = await request('/api/auth/login', { method: 'POST', body: { email, password: suppliedPassword, ...extra } });
        return { ...result, cookie: result.headers.get('set-cookie')?.split(';')[0] };
    };
    let adminCookie, teacher, teacherCookie, coordinator, coordinatorCookie;
    const event = { title: 'New event', startDate: '2026-09-13', endDate: '2026-09-14', startTime: '09:00', endTime: '10:00', category: 'activity', description: 'Calendar compatibility', days: { monday: true, sunday: true } };
    await t.test('anonymous access is denied to all protected APIs and HTML pages', async () => {
        for (const url of ['/api/auth/me', '/api/users', '/api/events']) assert.equal((await request(url)).status, 401);
        assert.equal((await request('/api/events', { method: 'POST', body: event })).status, 401);
        const html = await request('/');
        assert.equal(html.status, 302);
        assert.equal(html.headers.get('location'), '/login.html');
        assert.equal((await request('/login.html')).status, 200);
        for (const url of ['/backend/server.js', '/backend/.env', '/backend/migrations/001_auth.sql', '/.git/config']) assert.equal((await request(url)).status, 404);
    });
    await t.test('unknown email, wrong password and SQL injection return generic failures', async () => {
        const wrong = await login('admin@school.test', 'incorrect');
        const unknown = await login('unknown@school.test');
        const injection = await login("' OR 1=1 --");
        for (const result of [wrong, unknown, injection]) { assert.equal(result.status, 401); assert.ok(!result.cookie); }
        assert.deepEqual(wrong.data, unknown.data);
        assert.equal((await request('/api/auth/login', { method: 'POST', body: { email: [], password: [] } })).status, 400);
    });
    await t.test('login and me match the existing frontend contract without exposing credentials', async () => {
        const result = await login('  ADMIN@school.test  ');
        assert.equal(result.status, 200);
        adminCookie = result.cookie;
        assert.match(result.headers.get('set-cookie'), /HttpOnly/);
        assert.match(result.headers.get('set-cookie'), /SameSite=Lax/);
        assert.match(result.headers.get('set-cookie'), /Path=\//);
        const me = await request('/api/auth/me', { cookie: adminCookie });
        assert.equal(me.data.authenticated, true);
        assert.equal(me.data.user.role, 'admin');
        assert.equal(me.headers.get('cache-control'), 'no-store');
        for (const response of [result, me]) {
            assert.ok(!response.text.includes(password));
            assert.ok(!response.text.includes('password_hash'));
        }
        const token = adminCookie.split('=')[1];
        const session = (await pool.query('SELECT token_hash FROM auth_sessions')).rows[0];
        assert.equal(session.token_hash, digest(token));
        assert.notEqual(session.token_hash, token);
        assert.equal((await request('/', { cookie: adminCookie })).status, 200);
    });
    await t.test('admin creates teachers and coordinators; safe defaults and duplicate emails', async () => {
        const create = body => request('/api/users', { method: 'POST', cookie: adminCookie, body });
        const result = await create({ email: 'teacher@school.test', full_name: 'Teacher', password });
        assert.equal(result.status, 201);
        teacher = result.data.user;
        assert.equal(teacher.role, 'teacher');
        assert.equal(teacher.is_active, true);
        assert.deepEqual(teacher.grades, []);
        assert.ok(!result.text.includes('password_hash'));
        const second = await create({ email: 'coordinator@school.test', full_name: 'Coordinator', password, role: 'coordinator' });
        assert.equal(second.status, 201);
        coordinator = second.data.user;
        assert.equal((await create({ email: ' TEACHER@school.test ', full_name: 'Duplicate', password })).status, 409);
        assert.equal((await create({ email: 'invalid@school.test', full_name: 'Invalid', password, role: 'superadmin' })).status, 400);
        assert.equal((await create({ email: 'invalid@school.test', full_name: 'Invalid', password: 'short' })).status, 400);
        assert.equal((await create({ email: 'invalid@school.test', full_name: 'Invalid', password, password_hash: 'forged' })).status, 400);
        const list = await request('/api/users', { cookie: adminCookie });
        assert.equal(list.status, 200);
        assert.equal(list.data.users.length, 3);
        assert.ok(!list.text.includes('password_hash'));
    });
    await t.test('teacher and coordinator cannot manage users or forge roles at login', async () => {
        const teacherLogin = await login(teacher.email, password, { role: 'admin', is_active: true });
        teacherCookie = teacherLogin.cookie;
        assert.equal(teacherLogin.data.user.role, 'teacher');
        coordinatorCookie = (await login(coordinator.email)).cookie;
        for (const cookie of [teacherCookie, coordinatorCookie]) {
            assert.equal((await request('/api/users', { cookie })).status, 403);
            assert.equal((await request('/api/users', { method: 'POST', cookie, body: {} })).status, 403);
            assert.equal((await request(`/api/users/${teacher.id}`, { method: 'PATCH', cookie, body: { role: 'admin' } })).status, 403);
        }
        assert.equal((await request('/api/users', { headers: { Authorization: 'Bearer forged', 'X-Role': 'admin' } })).status, 401);
        assert.throws(() => requireRoles('superadmin'));
    });
    await t.test('user management HTML requires a current admin session and is never cached', async () => {
        const anonymous = await request('/users.html');
        assert.equal(anonymous.status, 302);
        assert.equal(anonymous.headers.get('location'), '/login.html');
        assert.equal(anonymous.headers.get('cache-control'), 'no-store');
        for (const cookie of [teacherCookie, coordinatorCookie]) {
            const denied = await request('/users.html', { cookie, headers: { 'X-Role': 'admin' } });
            assert.equal(denied.status, 403);
            assert.equal(denied.headers.get('cache-control'), 'no-store');
        }
        const allowed = await request('/users.html', { cookie: adminCookie });
        assert.equal(allowed.status, 200);
        assert.match(allowed.headers.get('content-type'), /^text\/html/);
        assert.equal(allowed.headers.get('cache-control'), 'no-store');
        const head = await request('/users.html', { method: 'HEAD', cookie: teacherCookie });
        assert.equal(head.status, 403);
        assert.equal(head.text, '');
        assert.equal(head.headers.get('cache-control'), 'no-store');
    });
    await t.test('calendar read/write permissions and dates preserve the existing contract', async () => {
        for (const cookie of [adminCookie, coordinatorCookie, teacherCookie]) {
            const result = await request('/api/events', { cookie });
            assert.equal(result.status, 200);
            assert.ok(Array.isArray(result.data));
            assert.equal(result.data[0].start_date, '2026-09-12');
            assert.equal(result.data[0].title, 'Existing event');
        }
        assert.equal((await request('/api/events', { method: 'POST', cookie: teacherCookie, body: event })).status, 403);
        for (const cookie of [coordinatorCookie, adminCookie]) assert.equal((await request('/api/events', { method: 'POST', cookie, body: event })).status, 201);
        const result = await request('/api/events', { cookie: teacherCookie });
        assert.equal(result.data.length, 3);
        assert.equal(result.data[1].start_date, event.startDate);
        assert.equal(result.data[1].end_date, event.endDate);
        assert.deepEqual(result.data[1].days, event.days);
        assert.equal((await request('/api/events', { method: 'POST', cookie: adminCookie, body: { ...event, startDate: 'invalid' } })).status, 400);
    });
    await t.test('CORS and JSON-only writes reject browser CSRF', async () => {
        assert.equal((await request('/api/auth/logout', { method: 'POST', cookie: adminCookie, body: {}, origin: 'https://evil.test' })).status, 403);
        assert.equal((await request('/api/auth/logout', { method: 'POST', cookie: adminCookie, body: 'anything', headers: { 'Content-Type': 'text/plain' } })).status, 415);
        assert.equal((await request('/api/auth/logout', { method: 'POST', cookie: adminCookie, body: {}, origin: null, headers: { 'Sec-Fetch-Site': 'cross-site' } })).status, 403);
        assert.equal((await request('/api/auth/login', { method: 'POST', body: '{' })).status, 400);
        const cors = await request('/api/auth/me', { cookie: adminCookie });
        assert.equal(cors.headers.get('access-control-allow-origin'), 'http://localhost:5500');
        assert.equal(cors.headers.get('access-control-allow-credentials'), 'true');
        assert.equal((await request('/api/auth/login', { method: 'OPTIONS', headers: { 'Access-Control-Request-Method': 'POST', 'Access-Control-Request-Headers': 'content-type' } })).status, 204);
    });
    await t.test('role change and deactivation revoke existing sessions', async () => {
        const change = await request(`/api/users/${coordinator.id}`, { method: 'PATCH', cookie: adminCookie, body: { role: 'teacher' } });
        assert.equal(change.status, 200);
        assert.equal((await request('/api/events', { cookie: coordinatorCookie })).status, 401);
        coordinatorCookie = (await login(coordinator.email)).cookie;
        assert.equal((await request('/api/events', { method: 'POST', cookie: coordinatorCookie, body: event })).status, 403);
        assert.equal((await request(`/api/users/${teacher.id}`, { method: 'PATCH', cookie: adminCookie, body: { is_active: false } })).status, 200);
        assert.equal((await request('/api/auth/me', { cookie: teacherCookie })).status, 401);
        assert.equal((await login(teacher.email)).status, 401);
    });
    await t.test('direct database security changes revoke sessions, including after reactivation', async () => {
        await pool.query("UPDATE users SET role = 'coordinator' WHERE id = $1", [coordinator.id]);
        assert.equal((await request('/api/events', { cookie: coordinatorCookie })).status, 401);
        coordinatorCookie = (await login(coordinator.email)).cookie;
        assert.equal((await request('/api/events', { method: 'POST', cookie: coordinatorCookie, body: event })).status, 201);
        await pool.query('UPDATE users SET is_active = FALSE WHERE id = $1', [coordinator.id]);
        assert.equal((await request('/api/auth/me', { cookie: coordinatorCookie })).status, 401);
        await pool.query('UPDATE users SET is_active = TRUE WHERE id = $1', [coordinator.id]);
        assert.equal((await request('/api/auth/me', { cookie: coordinatorCookie })).status, 401);
        coordinatorCookie = (await login(coordinator.email)).cookie;
    });
    await t.test('password reset revokes sessions and old credentials stop working', async () => {
        const nextPassword = randomBytes(24).toString('hex');
        const changed = await request(`/api/users/${coordinator.id}`, { method: 'PATCH', cookie: adminCookie, body: { password: nextPassword } });
        assert.equal(changed.status, 200);
        assert.ok(!changed.text.includes(nextPassword));
        assert.equal((await request('/api/auth/me', { cookie: coordinatorCookie })).status, 401);
        assert.equal((await login(coordinator.email)).status, 401);
        assert.equal((await login(coordinator.email, nextPassword)).status, 200);
    });
    await t.test('last active admin cannot be disabled or demoted', async () => {
        for (const body of [{ role: 'teacher' }, { is_active: false }]) assert.equal((await request(`/api/users/${admin.id}`, { method: 'PATCH', cookie: adminCookie, body })).status, 409);
        assert.equal((await request('/api/users', { cookie: adminCookie })).status, 200);
        assert.equal((await request('/api/users/not-an-id', { method: 'PATCH', cookie: adminCookie, body: { role: 'teacher' } })).status, 400);
        assert.equal((await request('/api/users/999999', { method: 'PATCH', cookie: adminCookie, body: { role: 'teacher' } })).status, 404);
    });
    await t.test('session rotation, tampering, expiration and logout', async () => {
        const rotated = await request('/api/auth/login', { method: 'POST', cookie: adminCookie, body: { email: admin.email, password } });
        assert.equal(rotated.status, 200);
        assert.equal((await request('/api/auth/me', { cookie: adminCookie })).status, 401);
        adminCookie = rotated.headers.get('set-cookie').split(';')[0];
        assert.equal((await request('/api/auth/me', { cookie: 'fld_session=forged' })).status, 401);
        assert.equal((await request('/api/auth/me', { cookie: `${adminCookie}; ${adminCookie}` })).status, 401);
        await pool.query("UPDATE auth_sessions SET expires_at = CURRENT_TIMESTAMP - INTERVAL '1 second' WHERE token_hash = $1", [digest(adminCookie.split('=')[1])]);
        assert.equal((await request('/api/auth/me', { cookie: adminCookie })).status, 401);
        adminCookie = (await login(admin.email)).cookie;
        const logout = await request('/api/auth/logout', { method: 'POST', cookie: adminCookie, body: {} });
        assert.equal(logout.status, 200);
        assert.equal(logout.data.authenticated, false);
        assert.match(logout.headers.get('set-cookie'), /Expires=Thu, 01 Jan 1970/);
        assert.equal((await request('/api/auth/me', { cookie: adminCookie })).status, 401);
        assert.equal((await request('/api/auth/logout', { method: 'POST', body: {} })).status, 200);
    });
    await t.test('repeated login attempts are limited in the database', async () => {
        for (let i = 0; i < 10; i++) assert.equal((await login('rate-limit@school.test')).status, 401);
        const result = await login('rate-limit@school.test');
        assert.equal(result.status, 429);
        assert.equal(result.headers.get('retry-after'), '900');
        assert.ok((await pool.query('SELECT attempts FROM auth_login_limits WHERE bucket_hash = $1', [digest('email:rate-limit@school.test')])).rows[0].attempts > 10);
    });
    await t.test('production refuses insecure configuration and uses secure host-only cookies', async () => {
        assert.throws(() => readConfig({ NODE_ENV: 'production' }));
        assert.throws(() => readConfig({ NODE_ENV: 'production', APP_ORIGINS: 'http://school.test' }));
        const production = readConfig({ NODE_ENV: 'production', APP_ORIGINS: 'https://school.test' });
        assert.equal(production.cookieName, '__Host-fld_session');
        const { cookieOptions } = require('../auth/middleware');
        assert.equal(cookieOptions(production).secure, true);
        assert.equal(cookieOptions(production).httpOnly, true);
        assert.ok(!('domain' in cookieOptions(production)));
    });
});
