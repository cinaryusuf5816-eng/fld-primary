const { test } = require('node:test');
const assert = require('node:assert/strict');
const { once } = require('node:events');
const { randomBytes } = require('node:crypto');
const { createApp } = require('../app');
const { readConfig } = require('../config');
const { migrate } = require('../scripts/migrate');
const { createInitialAdmin, createUser } = require('../auth/users');
const { digest } = require('../auth/middleware');
const academic = require('../academic');
const reportFormat = require('../../homework-report');
const { GRADES } = require('../auth/grades');
const { testDatabase } = require('./database');

test('persistent academic workflow enforces ownership and preserves accurate student reports', async t => {
    const database = await testDatabase();
    const { pool } = database;
    t.after(() => database.close());
    await migrate(pool);
    const password = randomBytes(24).toString('hex');
    const admin = await createInitialAdmin(pool, { email: 'academic-admin@school.test', full_name: 'Admin', password });
    const staff = { admin };
    for (const [key, role] of [['coordinator', 'coordinator'], ['teacher', 'teacher'], ['otherTeacher', 'teacher']]) {
        staff[key] = await createUser(pool, admin.id, { email: `${key.toLowerCase()}@school.test`, full_name: key, role, password, grades: role === 'teacher' ? GRADES : [] });
    }
    const config = readConfig({ APP_ORIGINS: 'http://localhost:5500' });
    const server = createApp({ pool, config }).listen(0, '127.0.0.1');
    await once(server, 'listening');
    t.after(() => new Promise(resolve => { server.close(resolve); server.closeAllConnections(); }));
    const base = `http://127.0.0.1:${server.address().port}`;
    async function request(url, { method = 'GET', body, cookie, origin = 'http://localhost:5500', headers = {} } = {}) {
        const response = await fetch(base + url, { method, redirect: 'manual', headers: {
            Origin: origin, ...(cookie ? { Cookie: cookie } : {}), ...(body !== undefined ? { 'Content-Type': 'application/json' } : {}), ...headers
        }, ...(body !== undefined ? { body: typeof body === 'string' ? body : JSON.stringify(body) } : {}) });
        const text = await response.text();
        let data; try { data = JSON.parse(text); } catch { data = text; }
        return { status: response.status, data, text, headers: response.headers };
    }
    for (const user of Object.values(staff)) {
        const login = await request('/api/auth/login', { method: 'POST', body: { email: user.email, password } });
        assert.equal(login.status, 200);
        user.cookie = login.headers.get('set-cookie').split(';')[0];
    }
    const today = (await pool.query("SELECT to_char((CURRENT_TIMESTAMP AT TIME ZONE 'Europe/Istanbul')::date,'YYYY-MM-DD') AS today")).rows[0].today;
    function day(offset) { const date = new Date(`${today}T12:00:00Z`); date.setUTCDate(date.getUTCDate() + offset); return date.toISOString().slice(0, 10); }
    const body = overrides => ({ title: 'Reading practice', description: 'Read chapter one.', grade: 'Grade 1', class_name: 'A', assign_date: day(-5), due_date: day(-1), ...overrides });
    async function homework(user = staff.teacher, overrides = {}) {
        const created = await request('/api/homework', { method: 'POST', cookie: user.cookie, body: body(overrides) });
        assert.equal(created.status, 201);
        return created.data.homework;
    }
    async function student(full_name, overrides = {}, user = staff.coordinator) {
        const created = await request('/api/students', { method: 'POST', cookie: user.cookie, body: { full_name, grade: 'Grade 1', class_name: 'A', ...overrides } });
        assert.equal(created.status, 201);
        return created.data.student;
    }
    const put = (assignment, checks, user = staff.teacher) => request(`/api/homework/${assignment.id}/checks`, { method: 'PUT', cookie: user.cookie, body: { checks } });
    let alice, bob, otherClass, own, another;

    await t.test('academic tables start empty and all academic endpoints require a session', async () => {
        for (const table of ['students', 'homework_assignments', 'homework_checks']) assert.equal((await pool.query(`SELECT * FROM ${table}`)).rows.length, 0);
        for (const url of ['/api/homework', '/api/students?grade=Grade%201&class_name=A', '/api/homework/1/checks', `/api/students/1/report?from=${day(-1)}&to=${today}`]) assert.equal((await request(url)).status, 401);
        assert.equal((await request('/api/homework', { method: 'POST', body: body() })).status, 401);
    });
    await t.test('only admins and coordinators can manage roster entries; history has no class moves', async () => {
        assert.equal((await request('/api/students', { method: 'POST', cookie: staff.teacher.cookie, body: { full_name: 'Denied', grade: 'Grade 1', class_name: 'A' } })).status, 403);
        alice = await student(' Alice ');
        bob = await student('Bob', {}, staff.admin);
        otherClass = await student('Other class', { class_name: 'B' });
        assert.equal(alice.full_name, 'Alice');
        assert.equal((await request(`/api/students/${alice.id}`, { method: 'PATCH', cookie: staff.teacher.cookie, body: { full_name: 'Denied' } })).status, 403);
        assert.equal((await request(`/api/students/${alice.id}`, { method: 'PATCH', cookie: staff.coordinator.cookie, body: { class_name: 'B' } })).status, 400);
        for (const user of Object.values(staff)) {
            const roster = await request('/api/students?grade=Grade%201&class_name=A', { cookie: user.cookie });
            assert.equal(roster.status, 200);
            assert.equal(roster.data.students.length, 2);
        }
        assert.equal((await request('/api/students?grade=Grade%205&class_name=A', { cookie: staff.admin.cookie })).status, 400);
        assert.equal((await request('/api/students', { method: 'POST', cookie: staff.admin.cookie, body: { full_name: 'Invalid', grade: 'Grade 1', class_name: 'H' } })).status, 400);
    });
    await t.test('all roles create and read homework while ownership is assigned by the server', async () => {
        own = await homework();
        another = await homework(staff.otherTeacher);
        for (const user of [staff.admin, staff.coordinator]) assert.equal(String((await homework(user)).created_by), String(user.id));
        assert.equal(String(own.created_by), String(staff.teacher.id));
        assert.equal(own.assign_date, day(-5));
        assert.equal(own.due_date, day(-1));
        for (const user of Object.values(staff)) {
            const all = await request('/api/homework', { cookie: user.cookie });
            assert.equal(all.status, 200);
            assert.equal(all.data.homeworks.length, 4);
            assert.equal(all.headers.get('cache-control'), 'no-store');
        }
        assert.equal((await request('/api/homework', { method: 'POST', cookie: staff.teacher.cookie, body: body({ created_by: admin.id }) })).status, 400);
    });
    await t.test('strict fields, calendar dates and IDs are rejected without changing records', async () => {
        for (const invalid of [body({ title: ' ' }), body({ grade: 'Grade 0' }), body({ class_name: 'AA' }), body({ assign_date: '2026-02-30' }), body({ due_date: day(-6) }), body({ is_archived: true }), body({ description: 'x'.repeat(10001) })]) {
            assert.equal((await request('/api/homework', { method: 'POST', cookie: staff.teacher.cookie, body: invalid })).status, 400);
        }
        assert.equal((await request('/api/homework/1%20OR%201=1/checks', { cookie: staff.teacher.cookie })).status, 400);
        assert.equal((await request('/api/homework/999999/checks', { cookie: staff.teacher.cookie })).status, 404);
        const payload = body({ title: "<script>alert('x')</script> '); DROP TABLE students; --", description: '<b>Read literally</b>' });
        const escaped = await request('/api/homework', { method: 'POST', cookie: staff.teacher.cookie, body: payload });
        assert.equal(escaped.status, 201);
        assert.equal(escaped.data.homework.title, payload.title);
        assert.equal(Number((await pool.query('SELECT count(*) FROM students')).rows[0].count), 3);
    });
    await t.test('teachers cannot edit or grade another teacher’s homework; privileged roles can', async () => {
        assert.equal((await request(`/api/homework/${another.id}`, { method: 'PATCH', cookie: staff.teacher.cookie, body: { title: 'Denied' } })).status, 403);
        assert.equal((await put(another, [{ student_id: alice.id, status: 'completed' }])).status, 403);
        for (const user of [staff.coordinator, staff.admin]) {
            assert.equal((await request(`/api/homework/${another.id}`, { method: 'PATCH', cookie: user.cookie, body: { title: 'Staff correction' } })).status, 200);
            assert.equal((await put(another, [{ student_id: alice.id, status: 'completed' }], user)).status, 200);
        }
        assert.equal((await request(`/api/homework/${own.id}`, { method: 'PATCH', cookie: staff.teacher.cookie, body: { created_by: admin.id } })).status, 400);
    });
    await t.test('grading is atomic, accepts only the assignment class and saves the latest review', async () => {
        for (const status of ['completed', 'partially-done', 'not-done', 'late', 'absent']) {
            const result = await put(own, [{ student_id: alice.id, status, note: `<script>literal</script> ${status}` }]);
            assert.equal(result.status, 200);
            assert.equal(result.data.checks.length, 1);
            assert.equal(result.data.checks[0].status, status);
            assert.equal(result.data.checks[0].note, `<script>literal</script> ${status}`);
            assert.ok(result.data.checks[0].checked_at);
        }
        for (const checks of [
            [{ student_id: bob.id, status: 'completed' }, { student_id: otherClass.id, status: 'not-done' }],
            [{ student_id: bob.id, status: 'completed' }, { student_id: bob.id, status: 'late' }],
            [{ student_id: bob.id, status: 'unknown' }], [{ student_id: bob.id, status: 'completed', checked_by: admin.id }],
            [{ student_id: bob.id, status: 'completed', note: 'x'.repeat(2001) }]
        ]) assert.equal((await put(own, checks)).status, 400);
        const saved = await request(`/api/homework/${own.id}/checks`, { cookie: staff.teacher.cookie });
        assert.equal(saved.data.checks.length, 1);
        assert.equal(saved.data.checks[0].status, 'absent');
        assert.equal((await request(`/api/homework/${own.id}`, { method: 'PATCH', cookie: staff.teacher.cookie, body: { class_name: 'B' } })).status, 409);
    });
    await t.test('future assignments are blocked, while already-assigned homework can be checked before its deadline', async () => {
        const future = await homework(staff.teacher, { assign_date: day(1), due_date: day(2) });
        assert.equal((await put(future, [{ student_id: alice.id, status: 'completed' }])).status, 409);
        const early = await homework(staff.teacher, { assign_date: today, due_date: day(2) });
        assert.equal((await put(early, [{ student_id: alice.id, status: 'completed' }])).status, 200);
        assert.equal((await request(`/api/students/${bob.id}`, { method: 'PATCH', cookie: staff.coordinator.cookie, body: { is_active: false } })).status, 200);
        assert.equal((await put(early, [{ student_id: bob.id, status: 'completed' }])).status, 400);
        assert.equal((await request('/api/students?grade=Grade%201&class_name=A', { cookie: staff.teacher.cookie })).data.students.length, 1);
        assert.equal((await request('/api/students?grade=Grade%201&class_name=A&include_inactive=true', { cookie: staff.teacher.cookie })).data.students.length, 2);
    });
    await t.test('unreviewed clears a saved check; archiving preserves checks and prevents further grading', async () => {
        assert.equal((await put(own, [{ student_id: alice.id, status: 'unreviewed', note: 'clear this too' }])).status, 200);
        assert.equal((await pool.query('SELECT * FROM homework_checks WHERE homework_id=$1', [own.id])).rows.length, 0);
        assert.equal((await put(own, [{ student_id: alice.id, status: 'completed' }])).status, 200);
        const archived = await request(`/api/homework/${own.id}`, { method: 'PATCH', cookie: staff.teacher.cookie, body: { is_archived: true } });
        assert.equal(archived.status, 200);
        assert.equal(archived.data.homework.is_archived, true);
        assert.equal((await put(own, [{ student_id: alice.id, status: 'unreviewed' }])).status, 409);
        assert.equal((await request(`/api/homework/${own.id}/checks`, { cookie: staff.teacher.cookie })).data.checks.length, 1);
        assert.ok((await request('/api/homework', { cookie: staff.teacher.cookie })).data.homeworks.some(item => String(item.id) === String(own.id) && item.is_archived));
    });
    await t.test('reports preserve archived homework and inactive students with inclusive dates and explicit unreviewed results', async () => {
        const reportStudent = await student('Report student', { grade: 'Grade 4', class_name: 'G' });
        const unreviewed = await student('Unreviewed student', { grade: 'Grade 4', class_name: 'G' });
        const assignments = [];
        for (const offset of [-2, -1, 0, 1]) assignments.push(await homework(staff.teacher, { grade: 'Grade 4', class_name: 'G', due_date: day(offset) }));
        await homework(staff.teacher, { grade: 'Grade 4', class_name: 'G', assign_date: day(1), due_date: day(1) });
        assert.equal((await put(assignments[1], [{ student_id: reportStudent.id, status: 'completed', note: 'Reviewed' }])).status, 200);
        assert.equal((await put(assignments[2], [{ student_id: reportStudent.id, status: 'not-done' }])).status, 200);
        await request(`/api/homework/${assignments[1].id}`, { method: 'PATCH', cookie: staff.teacher.cookie, body: { is_archived: true } });
        await request(`/api/students/${reportStudent.id}`, { method: 'PATCH', cookie: staff.admin.cookie, body: { is_active: false } });
        for (const user of [staff.teacher, staff.coordinator, staff.admin]) {
            const report = await request(`/api/students/${reportStudent.id}/report?from=${day(-1)}&to=${day(1)}`, { cookie: user.cookie });
            assert.equal(report.status, 200);
            assert.equal(report.data.student.is_active, false);
            assert.deepEqual(report.data.assignments.map(item => String(item.id)), assignments.slice(1).map(item => String(item.id)));
            assert.deepEqual(report.data.assignments.map(item => item.status), ['completed', 'not-done', 'unreviewed']);
            assert.equal(report.data.assignments[2].checked_at, null);
            assert.equal(report.data.assignments[2].note, '');
        }
        const emptyChecks = await request(`/api/students/${unreviewed.id}/report?from=${day(-1)}&to=${day(1)}`, { cookie: staff.teacher.cookie });
        assert.ok(emptyChecks.data.assignments.every(item => item.status === 'unreviewed' && item.checked_at === null));
        assert.equal(emptyChecks.data.assignments.filter(item => item.status === 'not-done').length, 0);
        assert.equal((await request(`/api/students/${reportStudent.id}/report?from=2026-02-30&to=${today}`, { cookie: staff.teacher.cookie })).status, 400);
        assert.equal((await request(`/api/students/${reportStudent.id}/report?from=${today}&to=${day(-1)}`, { cookie: staff.teacher.cookie })).status, 400);
    });
    await t.test('authenticated report attachments preserve class history and escape exported content', async () => {
        const pupil = await student('=HYPERLINK("https://example.test")', { grade: 'Grade 4', class_name: 'F' });
        const title = '<script>alert("report")</script>';
        const assignment = await homework(staff.teacher, { title, description: '<img src=x onerror=alert(1)>', grade: 'Grade 4', class_name: 'F', due_date: today });
        await homework(staff.teacher, { title: 'Excluded other class', grade: 'Grade 4', class_name: 'E', due_date: today });
        assert.equal((await put(assignment, [{ student_id: pupil.id, status: 'completed', note: '=SUM(1,2)' }])).status, 200);
        assert.equal((await request(`/api/homework/${assignment.id}`, { method: 'PATCH', cookie: staff.teacher.cookie, body: { is_archived: true } })).status, 200);
        assert.equal((await request(`/api/students/${pupil.id}`, { method: 'PATCH', cookie: staff.admin.cookie, body: { is_active: false } })).status, 200);
        const path = `/api/students/${pupil.id}/report/export`;
        for (const [period, user] of [['daily', staff.teacher], ['weekly', staff.coordinator], ['monthly', staff.admin]]) {
            const dates = reportFormat.range(today, period);
            const query = new URLSearchParams({ ...dates, period, format: 'csv' });
            const csv = await request(`${path}?${query}`, { cookie: user.cookie });
            assert.equal(csv.status, 200);
            assert.equal(csv.headers.get('cache-control'), 'no-store');
            assert.equal(csv.headers.get('content-type'), 'text/csv; charset=utf-8');
            assert.equal(csv.headers.get('content-disposition'), `attachment; filename="student-${pupil.id}-homework-${dates.from}-${dates.to}.csv"`);
            assert.ok(csv.text.includes('"\'=HYPERLINK(""https://example.test"")"'));
            assert.ok(csv.text.includes('"\'=SUM(1,2)"'));
            assert.ok(csv.text.includes('"Completed"'));
            assert.ok(csv.text.includes(`"${period[0].toUpperCase() + period.slice(1)}"`));
            assert.ok(!csv.text.includes('Excluded other class'));
            query.set('format', 'html');
            const html = await request(`${path}?${query}`, { cookie: user.cookie });
            assert.equal(html.status, 200);
            assert.equal(html.headers.get('content-type'), 'text/html; charset=utf-8');
            assert.equal(html.headers.get('content-disposition'), `attachment; filename="student-${pupil.id}-homework-${dates.from}-${dates.to}.html"`);
            assert.ok(html.text.includes('&lt;script&gt;alert(&quot;report&quot;)&lt;/script&gt;'));
            assert.ok(html.text.includes('&lt;img src=x onerror=alert(1)&gt;'));
            assert.ok(html.text.includes('Archived student'));
            assert.ok(!html.text.includes('<script>') && !html.text.includes('<img src=x'));
            assert.ok(!html.text.includes('Excluded other class'));
        }
        const valid = `from=${today}&to=${today}&period=daily&format=csv`;
        assert.equal((await request(`${path}?${valid}`)).status, 401);
        for (const query of [
            `from=${today}&to=${today}&format=csv`, `from=${today}&to=${today}&period=daily`,
            `${valid}&unexpected=true`, `${valid}&format=html`, `${valid}&from=${today}`,
            `from=${today}&to=${today}&period=yearly&format=csv`, `from=${today}&to=${today}&period=daily&format=pdf`,
            `from=${today}&to=${day(1)}&period=daily&format=csv`, `from=${today}&to=${today}&period=weekly&format=csv`,
            `from=2026-02-30&to=2026-02-30&period=daily&format=csv`, `from=${today}&to=${day(-1)}&period=daily&format=csv`
        ]) assert.equal((await request(`${path}?${query}`, { cookie: staff.teacher.cookie })).status, 400, query);
        assert.equal((await request(`/api/students/999999/report/export?${valid}`, { cookie: staff.teacher.cookie })).status, 404);
        assert.equal((await request(`/api/students/1%20OR%201=1/report/export?${valid}`, { cookie: staff.teacher.cookie })).status, 400);
    });
    await t.test('homework material links enforce the assignment audience and preserve archived attachments', async () => {
        async function material(title, grades, archived = false) {
            return (await pool.query(`INSERT INTO materials (title,grades,kind,url,created_by,is_archived,visibility,review_status)
                VALUES ($1,$2,'link','https://example.test/resource',$3,$4,$5,'approved') RETURNING id`, [title, grades, admin.id, archived, grades.length ? 'grades' : 'shared'])).rows[0];
        }
        const shared = await material('Shared reference', []);
        const scoped = await material('Grade 1 reference', ['Grade 1']);
        const outside = await material('Grade 2 reference', ['Grade 2']);
        const archived = await material('Archived reference', ['Grade 1'], true);
        const assignment = await homework(staff.teacher, { material_ids: [shared.id, scoped.id] });
        assert.deepEqual(assignment.material_ids, [shared.id, scoped.id].map(String));
        assert.ok(assignment.materials.every(item => Object.keys(item).sort().join(',') === 'academic_year,area,grades,id,in_materials,is_archived,kind,review_status,term,title,visibility'));
        assert.ok(assignment.materials.some(item => item.title === 'Shared reference'));
        const count = Number((await pool.query('SELECT count(*) FROM homework_assignments')).rows[0].count);
        for (const material_ids of [[outside.id], [archived.id], [shared.id, shared.id], ['999999'], [null], 'invalid', Array(31).fill(shared.id)]) {
            assert.equal((await request('/api/homework', { method: 'POST', cookie: staff.teacher.cookie, body: body({ material_ids }) })).status, 400);
        }
        assert.equal(Number((await pool.query('SELECT count(*) FROM homework_assignments')).rows[0].count), count);
        await pool.query('UPDATE materials SET is_archived=TRUE WHERE id=$1', [scoped.id]);
        const edited = await request(`/api/homework/${assignment.id}`, { method: 'PATCH', cookie: staff.teacher.cookie, body: { title: 'Retained attachment', material_ids: assignment.material_ids } });
        assert.equal(edited.status, 200);
        assert.ok(edited.data.homework.materials.some(item => String(item.id) === String(scoped.id) && item.is_archived));
        assert.equal((await request(`/api/homework/${assignment.id}`, { method: 'PATCH', cookie: staff.teacher.cookie, body: { grade: 'Grade 2' } })).status, 400);
        const cleared = await request(`/api/homework/${assignment.id}`, { method: 'PATCH', cookie: staff.teacher.cookie, body: { grade: 'Grade 2', material_ids: [] } });
        assert.equal(cleared.status, 200);
        assert.deepEqual(cleared.data.homework.material_ids, []);
        assert.deepEqual(cleared.data.homework.materials, []);
    });
    await t.test('duplicate warnings compare pages and titles within one class across all dates and archives', async () => {
        const matches = [];
        for (const offset of [-2, 0, 2]) matches.push(await homework(staff.teacher, {
            title: ' Reading    Book ', pages: ' 12 – 15 ', grade: 'Grade 2', class_name: 'F',
            assign_date: day(offset), due_date: day(offset)
        }));
        await request(`/api/homework/${matches[0].id}`, { method: 'PATCH', cookie: staff.teacher.cookie, body: { is_archived: true } });
        await homework(staff.teacher, { title: 'Reading Book', pages: '16-18', grade: 'Grade 2', class_name: 'F' });
        await homework(staff.teacher, { title: 'Reading Book', pages: '12-15', grade: 'Grade 2', class_name: 'G' });
        await homework(staff.teacher, { title: 'Reading Book', pages: '12-15', grade: 'Grade 3', class_name: 'F' });
        const input = { title: 'READING BOOK', pages: '12-15', grade: 'Grade 2', class_name: 'F' };
        const check = extra => request('/api/homework/check-duplicates', { method: 'POST', cookie: staff.teacher.cookie, body: { ...input, ...extra } });
        const result = await check();
        assert.equal(result.status, 200);
        assert.deepEqual(result.data.duplicates.map(item => String(item.id)).sort(), matches.map(item => String(item.id)).sort());
        assert.ok(result.data.duplicates.some(item => item.is_archived));
        assert.ok(result.data.duplicates.some(item => item.assign_date > today));
        assert.ok(result.data.duplicates.every(item => item.pages === '12 – 15'));
        assert.equal((await check({ exclude_id: matches[0].id })).data.duplicates.length, 2);
        assert.equal((await check({ pages: '16 - 18' })).data.duplicates.length, 1);
        assert.equal((await check({ pages: '19-20' })).data.duplicates.length, 0);
        assert.equal((await check({ pages: '' })).data.duplicates.length, 4);
        assert.equal((await check({ pages: 'x'.repeat(121) })).status, 400);
        assert.equal((await check({ exclude_id: '1 OR 1=1' })).status, 400);
        assert.equal((await check({ unknown: true })).status, 400);
        assert.equal((await request('/api/homework/check-duplicates', { method: 'POST', body: input })).status, 401);
        const repeat = await homework(staff.teacher, { ...input });
        assert.equal(repeat.pages, '12-15'); // Warnings never prevent an intentional repeat.
        const updated = await request(`/api/homework/${repeat.id}`, { method: 'PATCH', cookie: staff.teacher.cookie, body: { pages: '21-23' } });
        assert.equal(updated.status, 200);
        assert.equal(updated.data.homework.pages, '21-23');
    });
    await t.test('JSON and Origin defenses cover grading PUT and larger bounded class batches', async () => {
        const assignment = await homework(staff.teacher, { grade: 'Grade 3', class_name: 'C' });
        const students = [];
        for (let i = 0; i < 9; i++) students.push(await student(`Batch ${i}`, { grade: 'Grade 3', class_name: 'C' }));
        const checks = students.map(item => ({ student_id: item.id, status: 'completed', note: 'x'.repeat(1900) }));
        assert.equal((await put(assignment, checks)).status, 200);
        assert.equal((await request(`/api/homework/${assignment.id}/checks`, { method: 'PUT', cookie: staff.teacher.cookie, body: { checks }, origin: 'https://evil.test' })).status, 403);
        assert.equal((await request(`/api/homework/${assignment.id}/checks`, { method: 'PUT', cookie: staff.teacher.cookie, body: 'plain', headers: { 'Content-Type': 'text/plain' } })).status, 415);
        const preflight = await request(`/api/homework/${assignment.id}/checks`, { method: 'OPTIONS', headers: { 'Access-Control-Request-Method': 'PUT' } });
        assert.equal(preflight.status, 204);
        assert.match(preflight.headers.get('access-control-allow-methods'), /PUT/);
    });
    await t.test('write transactions recheck actor state and session instead of trusting stale middleware data', async () => {
        const session = { userId: staff.teacher.id, tokenHash: digest(staff.teacher.cookie.split('=')[1]) };
        await assert.rejects(academic.createStudent(pool, session, { full_name: 'Denied', grade: 'Grade 1', class_name: 'A' }), { status: 403 });
        await assert.rejects(academic.createHomework(pool, { ...session, userId: admin.id }, body()), { status: 401 });
        const count = Number((await pool.query('SELECT count(*) FROM homework_assignments')).rows[0].count);
        const stalePool = { connect: async () => {
            await pool.query('UPDATE users SET is_active=FALSE WHERE id=$1', [staff.teacher.id]);
            return pool.connect();
        } };
        await assert.rejects(academic.createHomework(stalePool, session, body()), { status: 401 });
        assert.equal(Number((await pool.query('SELECT count(*) FROM homework_assignments')).rows[0].count), count);
    });
});
