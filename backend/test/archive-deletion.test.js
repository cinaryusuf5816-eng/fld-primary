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
const { cleanupDeletedMaterialFiles } = require('../materials');
const { testDatabase } = require('./database');

test('Permanent Archive deletion is admin-only, protects references and durably cleans private files', async t => {
    const database = await testDatabase(), { pool } = database;
    t.after(() => database.close());
    await migrate(pool);
    const directory = await fs.mkdtemp(path.join(os.tmpdir(), 'fld-archive-delete-'));
    t.after(async () => {
        assert.equal(path.dirname(path.resolve(directory)), path.resolve(os.tmpdir()));
        assert.ok(path.basename(directory).startsWith('fld-archive-delete-'));
        await fs.rm(directory, { recursive: true, force: true });
    });
    const password = randomBytes(24).toString('hex');
    const admin = await createInitialAdmin(pool, { email: 'delete-admin@example.test', full_name: 'Admin', password });
    const coordinator = await createUser(pool, admin.id, { email: 'delete-coordinator@example.test', full_name: 'Coordinator', password, role: 'coordinator' });
    const teacher = await createUser(pool, admin.id, { email: 'delete-teacher@example.test', full_name: 'Teacher', password, role: 'teacher', grades: ['Grade 3'] });
    const config = readConfig({ APP_ORIGINS: 'http://localhost:5500', MATERIAL_STORAGE_DIR: directory });
    const server = createApp({ pool, config }).listen(0, '127.0.0.1');
    await once(server, 'listening');
    t.after(() => new Promise(resolve => { server.close(resolve); server.closeAllConnections(); }));
    const base = `http://127.0.0.1:${server.address().port}`;
    async function request(route, user = admin, method = 'GET', body, headers = {}) {
        const response = await fetch(base + route, { method, headers: { Origin: 'http://localhost:5500',
            ...(user?.cookie ? { Cookie: user.cookie } : {}), ...(body !== undefined ? { 'Content-Type': 'application/json' } : {}), ...headers },
        ...(body !== undefined ? { body: JSON.stringify(body) } : {}) });
        const text = await response.text(); let data; try { data = JSON.parse(text); } catch { data = text; }
        return { status: response.status, data, text, headers: response.headers };
    }
    for (const user of [admin, coordinator, teacher]) {
        const result = await request('/api/auth/login', null, 'POST', { email: user.email, password });
        assert.equal(result.status, 200); user.cookie = result.headers.get('set-cookie').split(';')[0];
    }
    async function record(title, fields = {}) {
        const result = await request('/api/archive', admin, 'POST', { title, kind: 'file', file_name: 'sample.txt',
            content_base64: Buffer.from('Private sample ' + title).toString('base64'), review_status: 'approved', ...fields });
        assert.equal(result.status, 201, result.text); return result.data.material;
    }
    async function folder(name, fields = {}) {
        const result = await request('/api/archive/folders', admin, 'POST', { name, ...fields });
        assert.equal(result.status, 201, result.text); return result.data.folder;
    }
    const storageKey = async id => (await pool.query('SELECT storage_key FROM materials WHERE id=$1', [id])).rows[0].storage_key;
    const jobs = async () => (await pool.query('SELECT storage_key,attempts FROM material_file_cleanup_jobs ORDER BY storage_key')).rows;

    await t.test('anonymous, teachers and coordinators cannot delete; JSON and Origin checks remain enforced', async () => {
        const file = await record('Permission check'), empty = await folder('Permission folder');
        for (const [user, status] of [[null, 401], [teacher, 403], [coordinator, 403]]) {
            for (const route of [`/api/archive/${file.id}`, `/api/archive/folders/${empty.id}`]) {
                assert.equal((await request(route, user, 'DELETE', {})).status, status);
            }
        }
        assert.equal((await request(`/api/archive/${file.id}`, admin, 'DELETE', {}, { Origin: 'https://evil.test' })).status, 403);
        assert.equal((await request(`/api/archive/${file.id}`, admin, 'DELETE')).status, 415);
        assert.equal((await request(`/api/archive/${file.id}`, admin, 'DELETE', { force: true })).status, 400);
        assert.equal((await request(`/api/archive/folders/${empty.id}`, admin, 'DELETE', ['invalid'])).status, 400);
        assert.equal((await request(`/api/materials/${file.id}/download`, teacher)).status, 200);
        assert.equal((await request(`/api/archive/${file.id}`, coordinator, 'PATCH', { is_archived: true })).status, 200);
        assert.equal((await request(`/api/archive/${file.id}`)).data.material.is_archived, true);
        assert.deepEqual(await jobs(), []);
    });
    await t.test('calendar and homework references reject deletion without removing bytes or usage', async () => {
        const homeworkFile = await record('Homework attachment'), eventFile = await record('Calendar attachment');
        const homework = await request('/api/homework', admin, 'POST', { title: 'Protected homework', grade: 'Grade 3', class_name: 'A',
            assign_date: '2026-09-01', due_date: '2026-09-02', material_ids: [homeworkFile.id] });
        assert.equal(homework.status, 201, homework.text);
        const event = await request('/api/events', admin, 'POST', { title: 'Protected lesson', startDate: '2026-09-01', endDate: '2026-09-01',
            startTime: '09:00', endTime: '10:00', category: 'programme', description: '', days: {}, material_ids: [eventFile.id] });
        assert.equal(event.status, 201, event.text);
        for (const file of [homeworkFile, eventFile]) {
            const key = await storageKey(file.id), before = await fs.readFile(path.join(directory, key));
            const result = await request(`/api/archive/${file.id}`, admin, 'DELETE', {});
            assert.equal(result.status, 409, result.text); assert.match(result.data.error, /linked to calendar events or homework/);
            assert.deepEqual(await fs.readFile(path.join(directory, key)), before);
            assert.equal((await request(`/api/materials/${file.id}/download`, teacher)).status, 200);
        }
        assert.deepEqual(await jobs(), []);
        assert.equal((await request(`/api/archive/${homeworkFile.id}`)).data.used_in.homework.length, 1);
        assert.equal((await request(`/api/archive/${eventFile.id}`)).data.used_in.events.length, 1);
    });
    await t.test('successful file and external-link deletion removes canonical records and preserves unrelated files', async () => {
        const file = await record('Delete bytes'), neighbor = await record('Keep bytes'), key = await storageKey(file.id), keepKey = await storageKey(neighbor.id);
        const response = await request(`/api/archive/${file.id}`, admin, 'DELETE', {});
        assert.equal(response.status, 200, response.text);
        assert.deepEqual(response.data, { deleted: true, id: String(file.id), storage_cleanup: 'complete' });
        await assert.rejects(fs.stat(path.join(directory, key)), { code: 'ENOENT' });
        assert.ok((await fs.stat(path.join(directory, keepKey))).isFile());
        for (const route of [`/api/archive/${file.id}`, `/api/materials/${file.id}`, `/api/materials/${file.id}/download`]) assert.equal((await request(route)).status, 404);
        assert.equal((await request(`/api/archive/${file.id}`, admin, 'DELETE', {})).status, 404);
        const link = await request('/api/archive', admin, 'POST', { title: 'External link', kind: 'link', url: 'https://example.test/resource' });
        assert.equal(link.status, 201);
        assert.equal((await request(`/api/archive/${link.data.material.id}`, admin, 'DELETE', {})).data.storage_cleanup, 'complete');
        assert.deepEqual(await jobs(), []);
    });
    await t.test('folders reject subfolders and all files, including retired records; empty folder deletion preserves siblings', async () => {
        const parent = await folder('Parent'), child = await folder('Child', { parent_id: parent.id }), sibling = await folder('Sibling');
        let result = await request(`/api/archive/folders/${parent.id}`, admin, 'DELETE', {});
        assert.equal(result.status, 409, result.text);
        assert.equal((await request(`/api/archive/folders/${child.id}`, admin, 'DELETE', {})).status, 200);
        const retired = await record('Retired child', { folder_id: parent.id });
        assert.equal((await request(`/api/archive/${retired.id}`, coordinator, 'PATCH', { is_archived: true })).status, 200);
        result = await request(`/api/archive/folders/${parent.id}`, admin, 'DELETE', {});
        assert.equal(result.status, 409); assert.match(result.data.error, /including retired files/);
        assert.equal((await request(`/api/archive/${retired.id}`, admin, 'DELETE', {})).status, 200);
        result = await request(`/api/archive/folders/${parent.id}`, admin, 'DELETE', {});
        assert.deepEqual(result.data, { deleted: true, id: String(parent.id) });
        assert.equal((await request(`/api/archive/folders/${parent.id}`)).status, 404);
        assert.equal((await request(`/api/archive/folders/${sibling.id}`)).status, 200);
        for (const id of ['root', '0', '-1', '9223372036854775808', '12abc']) {
            assert.equal((await request(`/api/archive/folders/${id}`, admin, 'DELETE', {})).status, 400);
        }
        assert.equal((await request('/api/archive/12abc', admin, 'DELETE', {})).status, 400);
        assert.equal((await request('/api/archive/folders/999999', admin, 'DELETE', {})).status, 404);
        const large = '9223372036854775800';
        await pool.query('INSERT INTO archive_folders(id,name,visibility) VALUES($1,$2,$3)', [large, 'Large empty ID', 'shared']);
        assert.equal((await request(`/api/archive/folders/${large}`, admin, 'DELETE', {})).data.id, large);
    });
    await t.test('failed cleanup retains a durable job and retries without unlinking live records or unvalidated paths', async () => {
        const file = await record('Deferred cleanup'), key = await storageKey(file.id), filename = path.join(directory, key), backup = path.join(directory, 'retained-test-bytes');
        await fs.rename(filename, backup);
        await fs.mkdir(filename);
        const result = await request(`/api/archive/${file.id}`, admin, 'DELETE', {});
        assert.equal(result.status, 200, result.text); assert.equal(result.data.storage_cleanup, 'pending');
        assert.equal((await request(`/api/archive/${file.id}`)).status, 404);
        assert.equal((await jobs())[0].storage_key, key);
        assert.ok((await fs.stat(filename)).isDirectory());
        const missingRoot = await cleanupDeletedMaterialFiles(pool, path.join(directory, 'missing-storage-root'));
        assert.equal(missingRoot.pending, 1); assert.equal(missingRoot.removed, 0);
        assert.equal((await jobs())[0].storage_key, key);
        await fs.rmdir(filename);
        await fs.rename(backup, filename);
        const retried = await cleanupDeletedMaterialFiles(pool, directory);
        assert.equal(retried.removed, 1); assert.equal(retried.pending, 0);
        await assert.rejects(fs.stat(filename), { code: 'ENOENT' });
        const live = await record('Live safety check'), liveKey = await storageKey(live.id);
        await pool.query('INSERT INTO material_file_cleanup_jobs(storage_key) VALUES($1)', [liveKey]);
        assert.equal((await cleanupDeletedMaterialFiles(pool, directory)).pending, 1);
        assert.equal((await request(`/api/materials/${live.id}/download`)).status, 200);
        await assert.rejects(pool.query('INSERT INTO material_file_cleanup_jobs(storage_key) VALUES($1)', ['../../outside.txt']));
        assert.equal((await request(`/api/archive/${live.id}`, admin, 'DELETE', {})).data.storage_cleanup, 'complete');
        assert.deepEqual(await jobs(), []);
    });
    await t.test('native concurrent inserts commit before deletion checks and remain protected', { skip: !process.env.AUTH_TEST_DATABASE_URL }, async () => {
        const file = await record('Concurrent file'), parent = await folder('Concurrent parent');
        const event = await request('/api/events', admin, 'POST', { title: 'Concurrent lesson', startDate: '2026-09-01', endDate: '2026-09-01',
            startTime: '09:00', endTime: '10:00', category: 'programme', description: '', days: {} });
        assert.equal(event.status, 201, event.text);
        const client = await pool.connect();
        try {
            await client.query('BEGIN');
            await client.query('SELECT id FROM materials WHERE id=$1 FOR SHARE', [file.id]);
            await client.query('INSERT INTO event_materials(event_id,material_id) VALUES($1,$2)', [event.data.id, file.id]);
            const deletingFile = request(`/api/archive/${file.id}`, admin, 'DELETE', {});
            await client.query('COMMIT');
            assert.equal((await deletingFile).status, 409);
            await client.query('BEGIN');
            await client.query('SELECT id FROM archive_folders WHERE id=$1 FOR SHARE', [parent.id]);
            await client.query("INSERT INTO archive_folders(name,parent_id,visibility) VALUES('Concurrent child',$1,'shared')", [parent.id]);
            const deletingFolder = request(`/api/archive/folders/${parent.id}`, admin, 'DELETE', {});
            await client.query('COMMIT');
            assert.equal((await deletingFolder).status, 409);
        } finally { await client.query('ROLLBACK'); client.release(); }
    });
});
