const { PGlite } = require('@electric-sql/pglite');
const { Pool } = require('pg');
const { randomBytes } = require('node:crypto');

async function testDatabase() {
    if (process.env.AUTH_TEST_DATABASE_URL) {
        // Only the explicitly supplied test database is used, never DB_* / DATABASE_URL.
        const schema = `fld_test_${randomBytes(12).toString('hex')}`;
        const control = new Pool({ connectionString: process.env.AUTH_TEST_DATABASE_URL });
        await control.query(`CREATE SCHEMA ${schema}`);
        const pool = new Pool({ connectionString: process.env.AUTH_TEST_DATABASE_URL, options: `-c search_path=${schema}` });
        return { pool, close: async () => {
            await pool.end();
            await control.query(`DROP SCHEMA ${schema} CASCADE`);
            await control.end();
        } };
    }
    const db = new PGlite();
    // PGlite has one connection. Hold it for the entire pg-style transaction.
    let tail = Promise.resolve();
    async function acquire() {
        const previous = tail;
        let release;
        tail = new Promise(resolve => { release = resolve; });
        await previous;
        return release;
    }
    const rawQuery = async (sql, values) => values ? db.query(sql, values) : (await db.exec(sql)).at(-1) || { rows: [] };
    const pool = {
        query: async (sql, values) => {
            const release = await acquire();
            try { return await rawQuery(sql, values); } finally { release(); }
        },
        connect: async () => ({ query: rawQuery, release: await acquire() })
    };
    return { pool, close: () => db.close() };
}
module.exports = { testDatabase };
