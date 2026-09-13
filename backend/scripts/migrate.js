const fs = require('node:fs/promises');
const path = require('node:path');
const { createPool, transaction } = require('../db');

async function migrate(pool) {
    const directory = path.join(__dirname, '../migrations');
    return transaction(pool, async client => {
        await client.query('SELECT pg_advisory_xact_lock(71425001)');
        await client.query(`CREATE TABLE IF NOT EXISTS fld_schema_migrations (
            name TEXT PRIMARY KEY, applied_at TIMESTAMPTZ NOT NULL DEFAULT CURRENT_TIMESTAMP)`);
        const applied = [];
        for (const name of (await fs.readdir(directory)).filter(name => name.endsWith('.sql')).sort()) {
            if ((await client.query('SELECT name FROM fld_schema_migrations WHERE name = $1', [name])).rows.length) continue;
            await client.query(await fs.readFile(path.join(directory, name), 'utf8'));
            await client.query('INSERT INTO fld_schema_migrations (name) VALUES ($1)', [name]);
            applied.push(name);
        }
        return applied;
    });
}

if (require.main === module) {
    const pool = createPool();
    migrate(pool).then(files => console.log(files.length ? `Applied: ${files.join(', ')}` : 'Database is up to date.'))
        .catch(() => {
            console.error('Migration failed and was rolled back. Check the connection, ownership, legacy columns, duplicate emails and roles; see AUTH.md.');
            process.exitCode = 1;
        }).finally(() => pool.end());
}
module.exports = { migrate };
