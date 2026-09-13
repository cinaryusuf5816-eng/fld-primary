const { test } = require('node:test');
const assert = require('node:assert/strict');
const { once } = require('node:events');
const { randomBytes } = require('node:crypto');
const fs = require('node:fs/promises');
const path = require('node:path');
const os = require('node:os');
const { createApp } = require('../app');
const { readConfig } = require('../config');
const { migrate } = require('../scripts/migrate');
const { createInitialAdmin, createUser } = require('../auth/users');
const { testDatabase } = require('./database');

test('Archive migration preserves existing material audiences and attachment identities', async t => {
    const database = await testDatabase();
    t.after(() => database.close());
    const { pool } = database;
    const migrations = path.join(__dirname, '../migrations');
    for (const file of (await fs.readdir(migrations)).filter(file => file.endsWith('.sql') && file < '008').sort()) {
        await pool.query(await fs.readFile(path.join(migrations, file), 'utf8'));
    }
    const admin = await createInitialAdmin(pool, { email: 'archive-upgrade@school.test', full_name: 'Upgrade', password: randomBytes(24).toString('hex') });
    const old = (await pool.query(`INSERT INTO materials (title,kind,url,created_by,grades,is_archived)
        VALUES ('Shared old','link','https://example.test/shared',$1,'{}',FALSE),
            ('Grade old','link','https://example.test/grade',$1,ARRAY['Grade 3'],TRUE) RETURNING id`, [admin.id])).rows;
    const homework = (await pool.query(`INSERT INTO homework_assignments(title,grade,class_name,assign_date,due_date,created_by)
        VALUES ('Preserved work','Grade 3','A','2025-09-01','2025-09-02',$1) RETURNING id`, [admin.id])).rows[0];
    await pool.query('INSERT INTO homework_materials(homework_id,material_id) VALUES($1,$2)', [homework.id, old[1].id]);
    await pool.query(await fs.readFile(path.join(migrations, '008_school_archive.sql'), 'utf8'));
    const records = (await pool.query('SELECT id,visibility,grades,is_archived,academic_year,review_status,in_materials FROM materials ORDER BY id')).rows;
    assert.deepEqual(records.map(item => String(item.id)), old.map(item => String(item.id)));
    assert.deepEqual(records.map(item => item.visibility), ['shared', 'grades']);
    assert.deepEqual(records[1].grades, ['Grade 3']);
    assert.equal(records[1].is_archived, true);
    assert.ok(records.every(item => item.academic_year === '' && item.review_status === 'approved' && item.in_materials));
    assert.equal((await pool.query('SELECT * FROM homework_materials')).rows.length, 1);
});

test('Archive keeps review, management documents, search facets and bulk changes private', async t => {
    const database = await testDatabase();
    const { pool } = database;
    t.after(() => database.close());
    await migrate(pool);
    const directory = await fs.mkdtemp(path.join(os.tmpdir(), 'fld-archive-test-'));
    t.after(async () => {
        assert.equal(path.dirname(path.resolve(directory)), path.resolve(os.tmpdir()));
        assert.ok(path.basename(directory).startsWith('fld-archive-test-'));
        await fs.rm(directory, { recursive: true, force: true });
    });
    const password = randomBytes(24).toString('hex');
    const admin = await createInitialAdmin(pool, { email: 'archive-admin@school.test', full_name: 'Admin', password });
    const staff = { admin };
    for (const [key, role, grades] of [['coordinator', 'coordinator', []], ['teacher', 'teacher', ['Grade 3']], ['empty', 'teacher', []]]) {
        staff[key] = await createUser(pool, admin.id, { email: `archive-${key}@school.test`, full_name: key, role, grades, password });
    }
    const config = readConfig({ APP_ORIGINS: 'http://localhost:5500', MATERIAL_STORAGE_DIR: directory });
    const server = createApp({ pool, config }).listen(0, '127.0.0.1');
    await once(server, 'listening');
    t.after(() => new Promise(resolve => { server.close(resolve); server.closeAllConnections(); }));
    const base = `http://127.0.0.1:${server.address().port}`;
    async function request(url, user, method = 'GET', body, extraHeaders = {}) {
        const response = await fetch(base + url, { method, redirect: 'manual', headers: {
            Origin: 'http://localhost:5500', ...(user?.cookie ? { Cookie: user.cookie } : {}),
            ...(body !== undefined ? { 'Content-Type': 'application/json' } : {}), ...extraHeaders
        }, ...(body !== undefined ? { body: typeof body === 'string' ? body : JSON.stringify(body) } : {}) });
        const bytes = Buffer.from(await response.arrayBuffer()), text = bytes.toString('utf8');
        let data; try { data = JSON.parse(text); } catch { data = text; }
        return { status: response.status, data, text, bytes, headers: response.headers };
    }
    for (const user of Object.values(staff)) {
        const login = await request('/api/auth/login', null, 'POST', { email: user.email, password });
        assert.equal(login.status, 200); user.cookie = login.headers.get('set-cookie').split(';')[0];
    }
    const fileBody = (title, fields = {}) => ({ title, kind: 'file', file_name: 'record.pdf', content_base64: Buffer.from(`%PDF-1.7\n${title}\n%%EOF`).toString('base64'), ...fields });
    async function create(title, fields = {}, user = admin, endpoint = '/api/archive') {
        const result = await request(endpoint, user, 'POST', fileBody(title, fields));
        assert.equal(result.status, 201, result.text); return result.data.material;
    }
    const shared = await create('Staff handbook', { visibility: 'shared', review_status: 'approved', academic_year: '2023-2024', area: 'Administration' });
    const grade3 = await create('Grade 3 annual report', { visibility: 'grades', grades: ['Grade 3'], review_status: 'approved', academic_year: '2024-2025', area: 'Reports', term: 'Full year' });
    const grade1 = await create('Grade 1 report', { visibility: 'grades', grades: ['Grade 1'], review_status: 'approved', academic_year: '2017-2018' });
    const management = await create('Secret payroll', { visibility: 'management', review_status: 'approved', academic_year: '2011-2012', area: 'Administration' });
    const pending = await create('Review draft', { visibility: 'grades', grades: ['Grade 3'], academic_year: '2012-2013', area: 'Meetings' });
    const retired = await create('Retired grade report', { visibility: 'grades', grades: ['Grade 3'], review_status: 'approved', academic_year: '2020-2021' });
    assert.equal((await request(`/api/archive/${retired.id}`, admin, 'PATCH', { is_archived: true })).status, 200);

    await t.test('unauthenticated uploads fail before JSON buffering and APIs retain Origin protections', async () => {
        assert.equal((await request('/api/archive', null, 'POST', '{invalid JSON')).status, 401);
        for (const url of ['/api/archive', `/api/archive/${shared.id}`, `/api/materials/${shared.id}/download`]) assert.equal((await request(url)).status, 401);
        assert.equal((await request('/archive.html')).status, 302);
        assert.equal((await request('/api/archive', admin, 'POST', fileBody('Blocked'), { Origin: 'https://evil.test' })).status, 403);
        assert.equal((await request('/api/archive', admin, 'POST', 'plain', { 'Content-Type': 'text/plain' })).status, 415);
    });
    await t.test('teacher lists, counts, year facets, details and downloads exclude pending and management', async () => {
        const listed = await request('/api/archive', staff.teacher);
        assert.equal(listed.status, 200); assert.equal(listed.data.total, 2);
        assert.deepEqual(listed.data.facets.years, ['2024-2025', '2023-2024']);
        assert.equal(listed.headers.get('cache-control'), 'no-store');
        const filtered = await request('/api/archive?grade=Grade%201', staff.teacher);
        assert.equal(filtered.data.total, 1); assert.deepEqual(filtered.data.facets.years, ['2023-2024']);
        assert.equal((await request('/api/archive?status=all', staff.empty)).data.total, 1);
        assert.equal((await request('/api/archive?visibility=management', staff.teacher)).data.total, 0);
        assert.deepEqual((await request('/api/archive?q=Secret%20payroll', staff.teacher)).data.facets.years, []);
        assert.equal((await request('/api/archive?status=needs_review', staff.teacher)).status, 403);
        for (const user of [staff.teacher, staff.empty]) for (const record of [grade1, management, pending]) {
            for (const url of [`/api/archive/${record.id}`, `/api/materials/${record.id}`, `/api/materials/${record.id}/download`]) {
                assert.equal((await request(url, user)).status, 404);
                assert.equal((await request(url, user, 'HEAD')).status, 404);
            }
        }
        const download = await request(`/api/materials/${grade3.id}/download`, staff.teacher);
        assert.equal(download.status, 200); assert.ok(download.text.startsWith('%PDF-'));
        assert.match(download.headers.get('content-disposition'), /^attachment;/);
        const detail = await request(`/api/archive/${shared.id}`, staff.empty);
        assert.ok(!Object.hasOwn(detail.data, 'possible_duplicates'));
        assert.ok(!detail.text.includes('storage_key') && !detail.text.includes('content_sha256') && !detail.text.includes('normalized_url'));
    });
    await t.test('server pagination and literal search obey strict classification filters', async () => {
        const first = (await request('/api/archive?limit=2&offset=0', staff.coordinator)).data;
        const second = (await request('/api/archive?limit=2&offset=2', admin)).data;
        assert.equal(first.total, 5); assert.equal(first.items.length, 2); assert.equal(second.items.length, 2);
        assert.ok(first.items.every(item => !second.items.some(other => String(other.id) === String(item.id))));
        const beyond = (await request('/api/archive?offset=100', admin)).data;
        assert.equal(beyond.total, 5); assert.deepEqual(beyond.items, []);
        assert.equal((await request('/api/archive?archived=all', admin)).data.total, 6);
        assert.equal((await request('/api/archive?status=needs_review', admin)).data.total, 1);
        assert.equal((await request('/api/archive?academic_year=2024-2025&area=Reports&term=Full%20year&q=annual', admin)).data.total, 1);
        assert.equal((await request('/api/archive?q=%25', admin)).data.total, 0);
        assert.equal((await request('/api/archive?q=%27%20OR%201%3D1%20--', admin)).data.total, 0);
        for (const query of ['limit=101', 'limit=0', 'offset=-1', 'limit=2&limit=3', 'unknown=x', 'academic_year=2024-2026', 'term=Autumn', 'visibility=public', 'archived=yes', 'status=draft']) {
            assert.equal((await request(`/api/archive?${query}`, admin)).status, 400, query);
        }
    });
    await t.test('teachers create only approved own-grade records; catalog promotion requires approved nonmanagement', async () => {
        assert.equal(pending.review_status, 'needs_review'); assert.equal(pending.in_materials, false);
        const teacherRecord = await create('Teacher submitted', { grades: ['Grade 3'] }, staff.teacher);
        assert.equal(teacherRecord.review_status, 'approved'); assert.equal(teacherRecord.in_materials, false);
        for (const fields of [{ grades: [] }, { grades: ['Grade 1'] }, { grades: [], visibility: 'management' }, { grades: ['Grade 3'], review_status: 'needs_review' }]) {
            assert.equal((await request('/api/archive', staff.teacher, 'POST', fileBody('Denied', fields))).status, 403);
        }
        assert.equal((await request(`/api/archive/${teacherRecord.id}`, staff.teacher, 'PATCH', { title: 'Denied' })).status, 403);
        assert.equal((await request('/api/archive/bulk', staff.teacher, 'POST', { ids: [teacherRecord.id], changes: { is_archived: true } })).status, 403);
        assert.equal((await request(`/api/archive/${pending.id}`, admin, 'PATCH', { in_materials: true })).status, 400);
        assert.equal((await request(`/api/archive/${management.id}`, admin, 'PATCH', { in_materials: true })).status, 400);
        assert.equal((await request(`/api/archive/${grade3.id}`, staff.coordinator, 'PATCH', { in_materials: true })).status, 200);
        const catalog = (await request('/api/materials', staff.teacher)).data.materials;
        assert.ok(catalog.some(item => String(item.id) === String(grade3.id)));
        assert.ok(!catalog.some(item => String(item.id) === String(teacherRecord.id)));
        const oldCaller = await create('Material caller', { grades: ['Grade 3'] }, staff.teacher, '/api/materials');
        assert.equal(oldCaller.review_status, 'approved'); assert.equal(oldCaller.in_materials, true); assert.equal(oldCaller.visibility, 'grades');
        for (const fields of [{ academic_year: '2025-2025' }, { academic_year: '0000-0001' }, { visibility: 'grades', grades: [] }, { visibility: 'management', grades: ['Grade 3'] }, { in_materials: 'true' }, { extra: true }]) {
            assert.equal((await request('/api/archive', admin, 'POST', fileBody('Invalid', fields))).status, 400);
        }
    });
    await t.test('bulk updates are atomic and linked records cannot lose their audience or approval', async () => {
        const unlinked = await create('Bulk free record', { review_status: 'approved' });
        const linked = await create('Bulk linked record', { visibility: 'grades', grades: ['Grade 3'], review_status: 'approved' });
        const today = (await pool.query("SELECT to_char(CURRENT_DATE,'YYYY-MM-DD') AS day")).rows[0].day;
        const homework = await request('/api/homework', admin, 'POST', { title: 'Attached work', grade: 'Grade 3', class_name: 'A', assign_date: today, due_date: today, material_ids: [linked.id] });
        assert.equal(homework.status, 201);
        const patch = body => request(`/api/archive/${linked.id}`, admin, 'PATCH', body);
        assert.equal((await patch({ visibility: 'management', grades: [] })).status, 409);
        assert.equal((await patch({ review_status: 'needs_review' })).status, 409);
        assert.equal((await patch({ grades: ['Grade 1'] })).status, 409);
        const failed = await request('/api/archive/bulk', admin, 'POST', { ids: [unlinked.id, linked.id], changes: { academic_year: '2027-2028', visibility: 'management', grades: [] } });
        assert.equal(failed.status, 409);
        assert.equal((await request(`/api/archive/${unlinked.id}`, admin)).data.material.academic_year, '');
        const success = await request('/api/archive/bulk', staff.coordinator, 'POST', { ids: [linked.id, unlinked.id], changes: { academic_year: '2026-2027', term: 'Term 2', area: 'Planning & Curriculum' } });
        assert.equal(success.status, 200); assert.equal(success.data.updated, 2);
        assert.ok(success.data.items.every(item => item.academic_year === '2026-2027'));
        assert.equal((await patch({ visibility: 'shared', grades: [] })).status, 200);
        assert.equal((await patch({ is_archived: true })).status, 200);
        assert.equal((await request(`/api/materials/${linked.id}/download`, staff.empty)).status, 200);
        for (const body of [{ ids: [], changes: { area: 'Other' } }, { ids: [unlinked.id, unlinked.id], changes: { area: 'Other' } }, { ids: Array(101).fill(unlinked.id), changes: { area: 'Other' } }, { ids: [unlinked.id], changes: { title: 'No bulk title' } }, { ids: [unlinked.id], changes: {} }, { ids: ['1 OR 1=1'], changes: { area: 'Other' } }, { ids: [unlinked.id], changes: { area: 'Other' }, extra: true }]) {
            assert.equal((await request('/api/archive/bulk', admin, 'POST', body)).status, 400);
        }
        assert.equal((await request('/api/archive/bulk', admin, 'POST', { ids: [unlinked.id, '999999'], changes: { area: 'Meetings' } })).status, 404);
        assert.equal((await request(`/api/archive/${unlinked.id}`, admin)).data.material.area, 'Planning & Curriculum');
    });
    await t.test('possible duplicates use file content or normalized URLs and are manager-only', async () => {
        const content = Buffer.from('%PDF-1.7\nIdentical contents\n%%EOF').toString('base64');
        const first = await create('Public duplicate', { visibility: 'shared', review_status: 'approved', content_base64: content });
        const second = await create('Private duplicate', { visibility: 'management', review_status: 'approved', content_base64: content });
        const manager = (await request(`/api/archive/${first.id}`, staff.coordinator)).data;
        assert.ok(manager.possible_duplicates.some(item => String(item.id) === String(second.id) && item.title === second.title));
        assert.ok(manager.possible_duplicates.every(item => Object.keys(item).sort().join(',') === 'id,title'));
        const teacher = await request(`/api/archive/${first.id}`, staff.empty);
        assert.ok(!Object.hasOwn(teacher.data, 'possible_duplicates') && !teacher.text.includes('Private duplicate'));
        const links = [];
        for (const url of ['https://EXAMPLE.test:443/folder', 'https://example.test/folder']) {
            const result = await request('/api/archive', admin, 'POST', { title: 'Same link', kind: 'link', url });
            assert.equal(result.status, 201); links.push(result.data.material);
        }
        assert.ok((await request(`/api/archive/${links[0].id}`, admin)).data.possible_duplicates.some(item => String(item.id) === String(links[1].id)));
        assert.notEqual(String(first.id), String(second.id)); // No automatic merge or removal.
    });
});
