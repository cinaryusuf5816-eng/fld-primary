const path = require('node:path');
const { createPool } = require('../db');
const { readConfig } = require('../config');
const { cleanupDeletedMaterialFiles } = require('../materials');

async function main() {
    const config = readConfig();
    const pool = createPool();
    try {
        const result = await cleanupDeletedMaterialFiles(pool, config.materialStorageDir || path.join(__dirname, '..', '.local-materials'));
        console.log(`File cleanup: ${result.removed} completed; ${result.pending} pending.`);
        if (result.pending) process.exitCode = 1;
    } finally { await pool.end(); }
}
if (require.main === module) main().catch(() => {
    console.error('File cleanup could not complete. Check the database and private storage access; queued jobs were retained.');
    process.exitCode = 1;
});
