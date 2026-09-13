const { test } = require('node:test');
const assert = require('node:assert/strict');
const { migrate } = require('../scripts/migrate');
const { testDatabase } = require('./database');

test('empty database migration creates auth and calendar tables together', async t => {
    const database = await testDatabase();
    t.after(() => database.close());
    await migrate(database.pool);
    const result = await database.pool.query('SELECT * FROM events');
    assert.equal(result.rows.length, 0);
    for (const table of ['students', 'homework_assignments', 'homework_checks']) {
        assert.equal((await database.pool.query(`SELECT * FROM ${table}`)).rows.length, 0);
    }
    assert.deepEqual(await migrate(database.pool), []);
});

test('academic foreign keys match an existing UUID user identity', async t => {
    const database = await testDatabase();
    t.after(() => database.close());
    const { pool } = database;
    await pool.query("CREATE TABLE users (id UUID PRIMARY KEY, email TEXT NOT NULL); INSERT INTO users VALUES ('b800a10c-533c-426b-a6a0-2cc37fdd704e', 'legacy-uuid@school.test')");
    await migrate(pool);
    const columns = await pool.query(`SELECT table_name, column_name, data_type FROM information_schema.columns
        WHERE table_schema=current_schema() AND ((table_name='homework_assignments' AND column_name='created_by')
        OR (table_name='homework_checks' AND column_name='checked_by')) ORDER BY table_name`);
    assert.equal(columns.rows.length, 2);
    assert.ok(columns.rows.every(column => column.data_type === 'uuid'));
    const created = await pool.query(`INSERT INTO homework_assignments (title,grade,class_name,assign_date,due_date,created_by)
        VALUES ('Legacy owner','Grade 1','A','2026-09-01','2026-09-02','b800a10c-533c-426b-a6a0-2cc37fdd704e') RETURNING created_by`);
    assert.equal(created.rows[0].created_by, 'b800a10c-533c-426b-a6a0-2cc37fdd704e');
});

test('upgrade preserves existing user IDs and disables accounts without hashes', async t => {
    const database = await testDatabase();
    t.after(() => database.close());
    const { pool } = database;
    await pool.query("CREATE TABLE users (id INTEGER PRIMARY KEY, email TEXT NOT NULL); INSERT INTO users VALUES (17, 'legacy@school.test')");
    await migrate(pool);
    const user = (await pool.query('SELECT * FROM users')).rows[0];
    assert.equal(user.id, 17);
    assert.equal(user.email, 'legacy@school.test');
    assert.equal(user.role, 'teacher');
    assert.deepEqual(user.grades, []);
    assert.equal(user.is_active, false);
    assert.equal(user.password_hash, '!reset-required!');
    const before = user.updated_at;
    await pool.query("UPDATE users SET full_name = 'Updated' WHERE id = 17");
    assert.ok(new Date((await pool.query('SELECT updated_at FROM users')).rows[0].updated_at) >= new Date(before));
    await assert.rejects(pool.query("UPDATE users SET role = 'owner' WHERE id = 17"));
    for (const grades of [['Grade 5'], ['Grade 1', 'Grade 1'], [null], [['Grade 1', 'Grade 2']]]) {
        await assert.rejects(pool.query('UPDATE users SET grades=$1 WHERE id=17', [grades]));
    }
    await pool.query('UPDATE users SET grades=$1 WHERE id=17', [['Grade 1', 'Grade 3']]);
    assert.deepEqual((await pool.query('SELECT grades FROM users WHERE id=17')).rows[0].grades, ['Grade 1', 'Grade 3']);
    await assert.rejects(pool.query("INSERT INTO users (id, email, password_hash) VALUES (18, 'LEGACY@school.test', '!reset-required!')"));
});

test('incompatible legacy plaintext columns fail and roll back without altering data', async t => {
    const database = await testDatabase();
    t.after(() => database.close());
    const { pool } = database;
    await pool.query('CREATE TABLE users (id INTEGER PRIMARY KEY, email TEXT, password TEXT)');
    await assert.rejects(migrate(pool), /Legacy password column/);
    assert.equal((await pool.query("SELECT column_name FROM information_schema.columns WHERE table_schema = current_schema() AND table_name = 'users' AND column_name = 'password_hash'")).rows.length, 0);
});

test('duplicate case-insensitive legacy emails roll back the entire migration', async t => {
    const database = await testDatabase();
    t.after(() => database.close());
    const { pool } = database;
    await pool.query("CREATE TABLE users (id INTEGER PRIMARY KEY, email TEXT); INSERT INTO users VALUES (1, 'a@school.test'), (2, 'A@school.test')");
    await assert.rejects(migrate(pool));
    assert.equal((await pool.query('SELECT * FROM users')).rows.length, 2);
    assert.equal((await pool.query("SELECT column_name FROM information_schema.columns WHERE table_schema = current_schema() AND table_name = 'users' AND column_name = 'role'")).rows.length, 0);
});
