require('./config');
const { Pool } = require('pg');

function createPool(env = process.env) {
    return new Pool(env.DATABASE_URL ? { connectionString: env.DATABASE_URL } : {
        user: env.DB_USER,
        host: env.DB_HOST,
        database: env.DB_NAME,
        password: env.DB_PASSWORD,
        port: Number(env.DB_PORT || 5432)
    });
}

async function transaction(pool, action) {
    const client = await pool.connect();
    try {
        await client.query('BEGIN');
        const result = await action(client);
        await client.query('COMMIT');
        return result;
    } catch (error) {
        await client.query('ROLLBACK');
        throw error;
    } finally {
        client.release();
    }
}

module.exports = { createPool, transaction };
