const { test } = require('node:test');
const assert = require('node:assert/strict');
const { once } = require('node:events');
const { randomBytes } = require('node:crypto');
const { createApp } = require('../app');
const { readConfig } = require('../config');
const { migrate } = require('../scripts/migrate');
const { createInitialAdmin, createUser } = require('../auth/users');
const { digest } = require('../auth/middleware');
const { GRADES, normalizeGrades, canAccessGrade, canAccessAudience } = require('../auth/grades');
const academic = require('../academic');
const { testDatabase } = require('./database');

test('grade helpers deny unassigned data and distinguish shared resources', () => {
    const teacher = { role: 'teacher', grades: ['Grade 1', 'Grade 3'], is_active: true };
    assert.deepEqual(normalizeGrades(['Grade 3', 'Grade 1']), ['Grade 1', 'Grade 3']);
    assert.equal(canAccessGrade(teacher, 'Grade 1'), true);
    assert.equal(canAccessGrade(teacher, 'Grade 2'), false);
    assert.equal(canAccessAudience(teacher, ['Grade 2', 'Grade 3']), true);
    assert.equal(canAccessAudience({ ...teacher, grades: [] }, []), true);
    assert.equal(canAccessAudience({ ...teacher, grades: [] }, ['Grade 1']), false);
    assert.equal(canAccessAudience({ ...teacher, is_active: false }, []), false);
    assert.equal(canAccessAudience({ ...teacher, deleted_at: new Date() }, []), false);
    assert.equal(canAccessAudience(null, []), false);
    for (const role of ['admin', 'coordinator']) for (const grade of GRADES) assert.equal(canAccessGrade({ role, grades: [] }, grade), true);
    for (const invalid of [null, 'Grade 1', ['Grade 5'], ['Grade 1', 'Grade 1'], [null], [['Grade 1']]]) assert.throws(() => normalizeGrades(invalid), { status: 400 });
});

test('grade assignments and account removal protect academic data and preserve history', async t => {
    const database = await testDatabase();
    const { pool } = database;
    t.after(() => database.close());
    await migrate(pool);
    const password = randomBytes(24).toString('hex');
    const admin = await createInitialAdmin(pool, { email: 'scope-admin@school.test', full_name: 'Admin', password });
    const staff = { admin };
    for (const [key, role, grades] of [['teacher', 'teacher', ['Grade 1', 'Grade 3']], ['empty', 'teacher', []], ['other', 'teacher', ['Grade 1']], ['coordinator', 'coordinator', []]]) {
        staff[key] = await createUser(pool, admin.id, { email: `scope-${key}@school.test`, full_name: key, role, grades, password });
    }
    const server = createApp({ pool, config: readConfig({ APP_ORIGINS: 'http://localhost:5500' }) }).listen(0, '127.0.0.1');
    await once(server, 'listening');
    t.after(() => new Promise(resolve => { server.close(resolve); server.closeAllConnections(); }));
    const base = `http://127.0.0.1:${server.address().port}`;
    async function request(url, user, method = 'GET', body) {
        const response = await fetch(base + url, { method, redirect: 'manual', headers: {
            Origin: 'http://localhost:5500', ...(user?.cookie ? { Cookie: user.cookie } : {}),
            ...(body !== undefined ? { 'Content-Type': 'application/json' } : {})
        }, ...(body !== undefined ? { body: JSON.stringify(body) } : {}) });
        const text = await response.text();
        let data; try { data = JSON.parse(text); } catch { data = text; }
        return { status: response.status, data, text, headers: response.headers };
    }
    async function login(user, extra = {}) {
        const result = await request('/api/auth/login', null, 'POST', { email: user.email, password, ...extra });
        if (result.status === 200) user.cookie = result.headers.get('set-cookie').split(';')[0];
        return result;
    }
    for (const user of Object.values(staff)) assert.equal((await login(user)).status, 200);
    const today = (await pool.query("SELECT to_char((CURRENT_TIMESTAMP AT TIME ZONE 'Europe/Istanbul')::date,'YYYY-MM-DD') AS day")).rows[0].day;
    const homeworkBody = (grade, title = `Work ${grade}`) => ({ title, grade, class_name: 'A', assign_date: today, due_date: today });
    const assignments = {}, students = {};
    for (const grade of GRADES) {
        const created = await request('/api/homework', admin, 'POST', homeworkBody(grade));
        assert.equal(created.status, 201);
        assignments[grade] = created.data.homework;
        const pupil = await request('/api/students', admin, 'POST', { full_name: `Student ${grade}`, grade, class_name: 'A' });
        assert.equal(pupil.status, 201);
        students[grade] = pupil.data.student;
    }
    let own;
    await t.test('teachers see only assigned grades on every academic read and direct export', async () => {
        assert.deepEqual((await request('/api/auth/me', staff.teacher)).data.user.grades, ['Grade 1', 'Grade 3']);
        const list = await request('/api/homework', staff.teacher);
        assert.deepEqual([...new Set(list.data.homeworks.map(item => item.grade))].sort(), ['Grade 1', 'Grade 3']);
        assert.ok(list.data.homeworks.every(item => Array.isArray(item.materials) && Array.isArray(item.material_ids)));
        assert.deepEqual((await request('/api/homework', staff.empty)).data.homeworks, []);
        assert.equal((await request('/api/homework/check-duplicates', staff.teacher, 'POST', { title: 'Work Grade 2', pages: '', grade: 'Grade 2', class_name: 'A' })).status, 403);
        for (const grade of ['Grade 2', 'Grade 4']) {
            assert.equal((await request(`/api/students?grade=${encodeURIComponent(grade)}&class_name=A&include_inactive=true`, staff.teacher)).status, 403);
            const checkPath = `/api/homework/${assignments[grade].id}/checks`;
            assert.equal((await request(checkPath, staff.teacher)).status, 404);
            assert.equal((await request(checkPath, staff.teacher, 'HEAD')).status, 404);
            const reportPath = `/api/students/${students[grade].id}/report`;
            assert.equal((await request(`${reportPath}?from=${today}&to=${today}`, staff.teacher)).status, 404);
            assert.equal((await request(`${reportPath}/export?from=${today}&to=${today}&period=daily&format=csv`, staff.teacher)).status, 404);
        }
        for (const user of [admin, staff.coordinator]) assert.equal((await request('/api/homework', user)).data.homeworks.length, 4);
        assert.equal((await request(`/api/homework/${assignments['Grade 1'].id}/checks`, staff.empty)).status, 404);
        assert.equal((await request(`/api/students?grade=Grade%201&class_name=A`, staff.teacher)).status, 200);
    });
    await t.test('grade permission and ownership both govern writes and moves', async () => {
        assert.equal((await request('/api/homework', staff.teacher, 'POST', homeworkBody('Grade 2'))).status, 403);
        assert.equal((await request('/api/homework', staff.empty, 'POST', homeworkBody('Grade 1'))).status, 403);
        const created = await request('/api/homework', staff.teacher, 'POST', homeworkBody('Grade 1', 'Owned assignment'));
        assert.equal(created.status, 201); own = created.data.homework;
        assert.equal((await request(`/api/homework/${own.id}`, staff.other, 'PATCH', { title: 'Not mine' })).status, 403);
        assert.equal((await request(`/api/homework/${own.id}`, staff.teacher, 'PATCH', { grade: 'Grade 2' })).status, 403);
        assert.equal((await request(`/api/homework/${assignments['Grade 2'].id}`, staff.teacher, 'PATCH', { grade: 'Grade 1' })).status, 404);
        const deniedChecks = await request(`/api/homework/${assignments['Grade 2'].id}/checks`, staff.teacher, 'PUT', { checks: [{ student_id: students['Grade 2'].id, status: 'completed' }] });
        assert.equal(deniedChecks.status, 404);
        assert.equal((await request(`/api/homework/${own.id}/checks`, staff.teacher, 'PUT', { checks: [{ student_id: students['Grade 1'].id, status: 'completed' }] })).status, 200);
        assert.equal((await request(`/api/homework/${own.id}`, staff.coordinator, 'PATCH', { title: 'Coordinator edit' })).status, 200);
    });
    await t.test('only admins assign grades and all old sessions are revoked immediately', async () => {
        for (const user of [staff.teacher, staff.coordinator]) assert.equal((await request(`/api/users/${staff.teacher.id}`, user, 'PATCH', { grades: GRADES })).status, 403);
        assert.equal((await request('/api/auth/profile', staff.teacher, 'PATCH', { full_name: 'Injected', grades: GRADES })).status, 400);
        const forged = await login(staff.empty, { role: 'admin', grades: GRADES });
        assert.deepEqual(forged.data.user.grades, []);
        for (const grades of [null, ['Grade 5'], ['Grade 1', 'Grade 1'], ['Grade 1', null], 'Grade 1']) assert.equal((await request(`/api/users/${staff.teacher.id}`, admin, 'PATCH', { grades })).status, 400);
        const previousSession = { userId: staff.teacher.id, tokenHash: digest(staff.teacher.cookie.split('=')[1]) };
        const changed = await request(`/api/users/${staff.teacher.id}`, admin, 'PATCH', { grades: ['Grade 3'] });
        assert.equal(changed.status, 200);
        assert.deepEqual(changed.data.user.grades, ['Grade 3']);
        assert.equal((await request('/api/auth/me', staff.teacher)).status, 401);
        await assert.rejects(academic.updateHomework(pool, previousSession, own.id, { title: 'Stale write' }), { status: 401 });
        assert.equal((await login(staff.teacher)).status, 200);
        assert.equal((await request(`/api/homework/${own.id}/checks`, staff.teacher)).status, 404);
        assert.equal((await request(`/api/homework/${own.id}`, staff.teacher, 'PATCH', { grade: 'Grade 3' })).status, 404);
        const actorSession = { userId: staff.teacher.id, tokenHash: digest(staff.teacher.cookie.split('=')[1]) };
        const racingPool = { connect: async () => {
            await pool.query('UPDATE users SET grades=$1 WHERE id=$2', [[], staff.teacher.id]);
            return pool.connect();
        } };
        await assert.rejects(academic.createHomework(racingPool, actorSession, homeworkBody('Grade 3')), { status: 401 });
        assert.equal((await request('/api/auth/me', staff.teacher)).status, 401);
        assert.equal(Number((await pool.query('SELECT count(*) FROM auth_sessions WHERE user_id=$1', [staff.teacher.id])).rows[0].count), 0);
        assert.equal((await login(staff.teacher)).status, 200);
        assert.deepEqual((await request('/api/homework', staff.teacher)).data.homeworks, []);
    });
    await t.test('removing a user hides the account, blocks login and preserves authored records', async () => {
        const url = `/api/users/${staff.teacher.id}/remove`;
        assert.equal((await request(url, null, 'POST', {})).status, 401);
        for (const user of [staff.teacher, staff.coordinator]) assert.equal((await request(url, user, 'POST', {})).status, 403);
        for (const body of [null, [], { is_active: false }]) assert.equal((await request(url, admin, 'POST', body)).status, 400);
        assert.equal((await request(`/api/users/${admin.id}/remove`, admin, 'POST', {})).status, 409);
        const removed = await request(url, admin, 'POST', {});
        assert.equal(removed.status, 200);
        assert.equal(removed.data.user.is_active, false);
        assert.ok(removed.data.user.deleted_at);
        assert.equal((await request('/api/auth/me', staff.teacher)).status, 401);
        assert.equal((await login(staff.teacher)).status, 401);
        const listed = (await request('/api/users', admin)).data.users;
        assert.ok(!listed.some(user => String(user.id) === String(staff.teacher.id)));
        assert.equal((await request(`/api/users/${staff.teacher.id}`, admin, 'PATCH', { is_active: true })).status, 404);
        assert.equal((await request(url, admin, 'POST', {})).status, 404);
        const history = (await request(`/api/homework/${own.id}/checks`, admin)).data;
        assert.equal(String(history.homework.created_by), String(staff.teacher.id));
        assert.equal(history.checks.length, 1);
        assert.equal(String(history.checks[0].checked_by), String(staff.teacher.id));
        await assert.rejects(pool.query('UPDATE users SET is_active=TRUE WHERE id=$1', [staff.teacher.id]));
    });
});
