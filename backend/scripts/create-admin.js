const readline = require('node:readline');
const { Writable } = require('node:stream');
const { createPool } = require('../db');
const { createInitialAdmin } = require('../auth/users');

function ask(prompt, hidden = false) {
    return new Promise((resolve, reject) => {
        const output = new Writable({ write(chunk, encoding, callback) {
            if (!hidden) process.stdout.write(chunk, encoding);
            callback();
        } });
        const rl = readline.createInterface({ input: process.stdin, output, terminal: true });
        process.stdout.write(prompt);
        rl.once('SIGINT', () => { rl.close(); reject(new Error('Cancelled.')); });
        rl.question('', answer => {
            rl.close();
            if (hidden) process.stdout.write('\n');
            resolve(answer);
        });
    });
}

async function main() {
    if (!process.stdin.isTTY || !process.stdout.isTTY || process.argv.length > 2) {
        throw new Error('Run npm run create-admin in an interactive terminal. Password arguments and piped input are not accepted.');
    }
    const email = await ask('Admin email: ');
    const full_name = await ask('Full name: ');
    let password = await ask('Password (hidden, 12–128 characters): ', true);
    let confirmation = await ask('Confirm password (hidden): ', true);
    if (password !== confirmation) throw new Error('Passwords do not match.');
    confirmation = '';
    const pool = createPool();
    try {
        const user = await createInitialAdmin(pool, { email, full_name, password });
        console.log(`Initial admin created: ${user.email}. Sign in through login.html.`);
    } finally {
        password = '';
        await pool.end();
    }
}

if (require.main === module) main().catch(error => {
    console.error(error.code ? 'Admin creation failed. Check database setup and whether the email already exists.' : error.message);
    process.exitCode = 1;
});
module.exports = { ask };
