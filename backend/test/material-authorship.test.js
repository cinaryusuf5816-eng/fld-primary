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
const library = require('../materials');
const { testDatabase } = require('./database');

test('File attribution identifies the verified creator and latest editor across Archive and Materials', async t => {
    const database = await testDatabase(), { pool } = database;
    t.after(() => database.close());
    await migrate(pool);
    const directory = await fs.mkdtemp(path.join(os.tmpdir(), 'fld-authorship-'));
    t.after(async () => {
        assert.equal(path.dirname(path.resolve(directory)), path.resolve(os.tmpdir()));
        assert.ok(path.basename(directory).startsWith('fld-authorship-'));
        await fs.rm(directory, { recursive: true, force: true });
    });
    const password = randomBytes(24).toString('hex');
    const admin = await createInitialAdmin(pool, { email: 'author-admin@example.test', full_name: 'Alex Admin', password });
    const teacher = await createUser(pool, admin.id, { email: 'author-teacher@example.test', full_name: 'Taylor Teacher', password, role: 'teacher', grades: ['Grade 3'] });
    const coordinator = await createUser(pool, admin.id, { email: 'author-coordinator@example.test', full_name: 'Casey Coordinator', password, role: 'coordinator' });
    const config = readConfig({ APP_ORIGINS: 'http://localhost:5500', MATERIAL_STORAGE_DIR: directory });
    const server = createApp({ pool, config }).listen(0, '127.0.0.1');
    await once(server, 'listening');
    t.after(() => new Promise(resolve => { server.close(resolve); server.closeAllConnections(); }));
    const base = `http://127.0.0.1:${server.address().port}`;
    async function request(route, user = admin, method = 'GET', body) {
        const response = await fetch(base + route, { method, headers: { Origin: 'http://localhost:5500',
            ...(user?.cookie ? { Cookie: user.cookie } : {}), ...(body !== undefined ? { 'Content-Type': 'application/json' } : {}) },
        ...(body !== undefined ? { body: JSON.stringify(body) } : {}) });
        const text = await response.text(); let data; try { data = JSON.parse(text); } catch { data = text; }
        return { status: response.status, data, text, headers: response.headers };
    }
    for (const user of [admin, teacher, coordinator]) {
        const result = await request('/api/auth/login', null, 'POST', { email: user.email, password });
        assert.equal(result.status, 200); user.cookie = result.headers.get('set-cookie').split(';')[0];
    }
    const fileBody = (title, fields = {}) => ({ title, kind: 'file', file_name: 'sample.txt',
        content_base64: Buffer.from('Authorship sample ' + title).toString('base64'), grades: ['Grade 3'], review_status: 'approved', ...fields });
    const created = await request('/api/archive', teacher, 'POST', fileBody('Teacher upload'));
    assert.equal(created.status, 201, created.text);
    const file = created.data.material;
    const second = await request('/api/materials', teacher, 'POST', { title: 'Teacher link', kind: 'link', url: 'https://example.test/resource', grades: ['Grade 3'] });
    assert.equal(second.status, 201, second.text); const link = second.data.material;
    const detail = async id => (await request(`/api/archive/${id}`)).data.material;
    function edited(record, actor) {
        assert.equal(record.creator_name, 'Taylor Teacher');
        assert.equal(record.last_editor_name, actor.full_name);
        assert.equal(record.edit_history_status, 'edited');
        assert.ok(Number.isFinite(Date.parse(record.last_edited_at)));
        assert.equal(String(record.created_by), String(teacher.id));
        assert.ok(!Object.hasOwn(record, 'last_edited_by'));
    }

    await t.test('new uploads and links show their creator without fabricating a previous editor', async () => {
        for (const record of [file, link]) {
            assert.equal(record.creator_name, teacher.full_name);
            assert.equal(record.edit_history_status, 'not_edited');
            assert.equal(record.last_editor_name, null); assert.equal(record.last_edited_at, null);
            assert.ok(Number.isFinite(Date.parse(record.created_at)));
        }
        assert.equal((await request(`/api/materials/${file.id}`, teacher)).data.material.creator_name, teacher.full_name);
    });
    await t.test('ordinary edits, retirement, restoration, promotion, bulk classification and moves record the actual actor', async () => {
        let result = await request(`/api/archive/${file.id}`, admin, 'PATCH', { title: 'Updated worksheet' });
        assert.equal(result.status, 200, result.text); edited(result.data.material, admin);
        assert.equal(result.data.material.created_at, file.created_at);
        result = await request(`/api/materials/${link.id}`, coordinator, 'PATCH', { description: 'Reviewed instructions' });
        assert.equal(result.status, 200, result.text); edited(result.data.material, coordinator);
        result = await request(`/api/archive/${file.id}`, coordinator, 'PATCH', { is_archived: true });
        assert.equal(result.status, 200, result.text); edited(result.data.material, coordinator);
        result = await request(`/api/archive/${file.id}`, admin, 'PATCH', { is_archived: false, in_materials: true });
        assert.equal(result.status, 200, result.text); edited(result.data.material, admin);
        result = await request('/api/archive/bulk', coordinator, 'POST', { ids: [file.id, link.id], changes: { academic_year: '2026-2027' } });
        assert.equal(result.status, 200, result.text); result.data.items.forEach(record => edited(record, coordinator));
        const folder = await request('/api/archive/folders', admin, 'POST', { name: 'Grade files', visibility: 'grades', grades: ['Grade 3'] });
        assert.equal(folder.status, 201, folder.text);
        result = await request('/api/archive/move', admin, 'POST', { ids: [file.id, link.id], folder_id: folder.data.folder.id });
        assert.equal(result.status, 200, result.text); result.data.items.forEach(record => edited(record, admin));
        const before = await detail(file.id);
        const failed = await request('/api/archive/bulk', coordinator, 'POST', { ids: [file.id, '999999'], changes: { term: 'Term 2' } });
        assert.equal(failed.status, 404);
        assert.deepEqual(await detail(file.id), before);
    });
    await t.test('clients cannot forge creator/editor fields and rejected changes leave attribution intact', async () => {
        const fields = { created_by: admin.id, creator_name: 'Forged creator', last_edited_by: admin.id, last_editor_name: 'Forged editor',
            last_edited_at: '2000-01-01T00:00:00Z', edit_history_status: 'not_edited' };
        const before = await detail(file.id);
        for (const [key, value] of Object.entries(fields)) {
            assert.equal((await request('/api/archive', teacher, 'POST', fileBody('Spoof attempt', { [key]: value }))).status, 400, key);
            assert.equal((await request(`/api/archive/${file.id}`, admin, 'PATCH', { [key]: value })).status, 400, key);
        }
        assert.equal((await request(`/api/archive/${file.id}`, teacher, 'PATCH', { title: 'Teacher edit' })).status, 403);
        assert.deepEqual(await detail(file.id), before);
    });
    await t.test('list/detail attribution remains grade-scoped and contains names without private account data', async () => {
        const restricted = await request('/api/archive', admin, 'POST', fileBody('Private Grade 4', { grades: ['Grade 4'], in_materials: true }));
        assert.equal(restricted.status, 201, restricted.text);
        for (const route of ['/api/archive', '/api/materials']) {
            const response = await request(route, teacher);
            assert.equal(response.status, 200, response.text);
            const records = Array.isArray(response.data) ? response.data : response.data.items || response.data.materials;
            assert.ok(records.some(record => String(record.id) === String(file.id) && record.creator_name === teacher.full_name));
            assert.ok(records.every(record => String(record.id) !== String(restricted.data.material.id)));
            for (const forbidden of [admin.email, teacher.email, coordinator.email, 'password_hash', 'last_edited_by']) assert.ok(!response.text.includes(forbidden), forbidden);
        }
        assert.equal((await request(`/api/archive/${restricted.data.material.id}`, teacher)).status, 404);
        assert.equal((await request(`/api/materials/${restricted.data.material.id}`, teacher)).status, 404);
    });
    await t.test('removed staff keep their known name; missing names never imply removal unless recorded', async () => {
        const changed = await request(`/api/archive/${file.id}`, coordinator, 'PATCH', { description: 'Last coordinated edit' });
        assert.equal(changed.status, 200, changed.text);
        const removed = await request(`/api/users/${coordinator.id}/remove`, admin, 'POST', {});
        assert.equal(removed.status, 200, removed.text);
        edited(await detail(file.id), coordinator);
        assert.equal((await request(`/api/archive/${file.id}`, coordinator, 'PATCH', { title: 'Stale session' })).status, 401);
        await pool.query("UPDATE users SET full_name='' WHERE id=$1", [coordinator.id]);
        assert.equal((await detail(file.id)).last_editor_name, 'Former staff member');
        await pool.query("UPDATE users SET full_name='' WHERE id=$1", [teacher.id]);
        assert.equal((await detail(file.id)).creator_name, 'Not recorded');
    });
});

for (const [type, actorId] of [['INTEGER', 17], ['UUID', 'b800a10c-533c-426b-a6a0-2cc37fdd704e']]) {
    test(`Authorship migration preserves legacy rows and supports ${type} user identities without invented editor history`, async t => {
        const database = await testDatabase(), { pool } = database;
        t.after(() => database.close());
        await pool.query(`CREATE TABLE users(id ${type} PRIMARY KEY,email TEXT NOT NULL)`);
        await pool.query('INSERT INTO users(id,email) VALUES($1,$2)', [actorId, 'legacy-author@example.test']);
        const directory = path.join(__dirname, '../migrations');
        for (const name of (await fs.readdir(directory)).filter(name => name.endsWith('.sql') && name < '011').sort()) {
            await pool.query(await fs.readFile(path.join(directory, name), 'utf8'));
        }
        await pool.query("UPDATE users SET full_name='Legacy Staff',role='admin',is_active=TRUE WHERE id=$1", [actorId]);
        const old = (await pool.query(`INSERT INTO materials(title,kind,url,created_by,created_at,updated_at)
            VALUES('Legacy document','link','https://example.test/legacy',$1,'2024-01-01','2025-01-01')
            RETURNING id,title,created_by,created_at,updated_at`, [actorId])).rows[0];
        await pool.query(await fs.readFile(path.join(directory, '011_material_authorship.sql'), 'utf8'));
        const preserved = (await pool.query('SELECT id,title,created_by,created_at,updated_at FROM materials WHERE id=$1', [old.id])).rows[0];
        assert.deepEqual(preserved, old);
        const actor = { id: actorId, role: 'admin', is_active: true, grades: [] };
        const record = await library.materialById(pool, actor, old.id);
        assert.equal(record.creator_name, 'Legacy Staff'); assert.equal(record.edit_history_status, 'unknown');
        assert.equal(record.last_editor_name, null); assert.equal(record.last_edited_at, null);
        const tokenHash = randomBytes(32).toString('hex');
        await pool.query("INSERT INTO auth_sessions(token_hash,user_id,expires_at) VALUES($1,$2,CURRENT_TIMESTAMP+INTERVAL '1 hour')", [tokenHash, actorId]);
        const updated = await library.updateMaterial(pool, { userId: actorId, tokenHash }, old.id, { title: 'First known edit' }, { archive: true });
        assert.equal(updated.edit_history_status, 'edited'); assert.equal(updated.last_editor_name, 'Legacy Staff');
        assert.equal(String((await pool.query('SELECT last_edited_by FROM materials WHERE id=$1', [old.id])).rows[0].last_edited_by), String(actorId));
        assert.equal(new Date(updated.created_at).getTime(), new Date(old.created_at).getTime());
    });
}
