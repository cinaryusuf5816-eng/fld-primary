const path = require('node:path');
require('dotenv').config({ path: path.join(__dirname, '.env'), quiet: true });

function readConfig(env = process.env) {
    const production = env.NODE_ENV === 'production';
    const port = Number(env.PORT || 3000);
    if (!Number.isInteger(port) || port < 1 || port > 65535) throw new Error('Invalid PORT.');
    const origins = (env.APP_ORIGINS || (production ? '' :
        `http://localhost:${port},http://127.0.0.1:${port},http://localhost:5500,http://127.0.0.1:5500`))
        .split(',').map(value => value.trim()).filter(Boolean);
    if (!origins.length) throw new Error('APP_ORIGINS is required in production.');
    for (const origin of origins) {
        const url = new URL(origin);
        if (url.origin !== origin || !['http:', 'https:'].includes(url.protocol) ||
            (production && url.protocol !== 'https:')) throw new Error('Invalid APP_ORIGINS.');
    }
    return { port, production, origins, sessionMs: 8 * 60 * 60 * 1000,
        cookieName: production ? '__Host-fld_session' : 'fld_session',
        trustProxy: env.TRUST_PROXY || false,
        materialStorageDir: path.resolve(env.MATERIAL_STORAGE_DIR || path.join(__dirname, '.local-materials')) };
}

module.exports = { readConfig };
