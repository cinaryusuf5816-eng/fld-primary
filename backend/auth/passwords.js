const { scrypt, randomBytes, timingSafeEqual } = require('node:crypto');
const { promisify } = require('node:util');
const derive = promisify(scrypt);
const options = { N: 32768, r: 8, p: 3, maxmem: 64 * 1024 * 1024 };
const prefix = 'scrypt$32768$8$3$';
const pattern = /^scrypt\$32768\$8\$3\$[a-f0-9]{32}\$[a-f0-9]{128}$/;
// A valid-shaped dummy record makes unknown-account checks run the same KDF.
const dummy = `${prefix}${'0'.repeat(32)}$${'0'.repeat(128)}`;

function validPassword(password) {
    return typeof password === 'string' && [...password].length >= 12 &&
        [...password].length <= 128 && Buffer.byteLength(password, 'utf8') <= 512;
}

async function hashPassword(password) {
    if (!validPassword(password)) throw new Error('Password must contain 12–128 characters (maximum 512 UTF-8 bytes).');
    const salt = randomBytes(16).toString('hex');
    const hash = await derive(password, salt, 64, options);
    return `${prefix}${salt}$${hash.toString('hex')}`;
}

async function verifyPassword(password, stored) {
    const supported = typeof stored === 'string' && pattern.test(stored);
    const parts = (supported ? stored : dummy).split('$');
    const hash = await derive(password, parts[4], 64, options);
    return timingSafeEqual(hash, Buffer.from(parts[5], 'hex')) && supported;
}

module.exports = { hashPassword, verifyPassword, validPassword };
