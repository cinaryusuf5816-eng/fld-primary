// Local Windows setup only. No secrets in arguments, output, status files or logs.
const fs = require('node:fs');
const path = require('node:path');
const { spawn } = require('node:child_process');
const net = require('node:net');
const { ensureLocalDatabase } = require('./local-postgres');
const { createInitialAdmin } = require('../auth/users');
const { validPassword } = require('../auth/passwords');

const backend = path.join(__dirname, '..');
const statusPath = path.join(backend, '.local-setup-status.json');
const pidPath = path.join(backend, '.local-server.pid');
const ACCOUNT = 'admin@fld.local';
let phase = 'check';
function status(state, extra = {}) {
    fs.writeFileSync(statusPath, JSON.stringify({ state, phase, time: new Date().toISOString(), ...extra }, null, 2));
}
function fail(message) { return Object.assign(new Error(message), { safeMessage: message }); }
async function readInput() {
    let text = '';
    process.stdin.setEncoding('utf8');
    for await (const chunk of process.stdin) {
        text += chunk.toString('utf8');
        if (text.length > 8192) throw fail('Girdi cok uzun.');
    }
    let input;
    try { input = JSON.parse(text); } catch { throw fail('Kurulumu Start-Local.ps1 dosyasi ile baslatin.'); }
    text = '';
    if (!validPassword(input.adminPassword)) {
        throw fail('Admin sifresi 12-128 karakter olmali.');
    }
    return input;
}
async function verifySite(url, password) {
    const response = await fetch(`${url}/api/auth/login`, {
        method: 'POST', headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ email: ACCOUNT, password }), signal: AbortSignal.timeout(10000)
    });
    if (response.status !== 200) throw fail('Site acildi ama admin girisi dogrulanamadi.');
    const cookie = response.headers.get('set-cookie')?.split(';')[0];
    const events = await fetch(`${url}/api/events`, { headers: { Cookie: cookie }, signal: AbortSignal.timeout(5000) });
    if (events.status !== 200 || !Array.isArray(await events.json())) throw fail('Takvim baglantisi dogrulanamadi.');
    const logout = await fetch(`${url}/api/auth/logout`, { method: 'POST', headers: { Cookie: cookie, 'Content-Type': 'application/json' }, body: '{}', signal: AbortSignal.timeout(5000) });
    if (logout.status !== 200) throw fail('Oturum kapatma dogrulanamadi.');
}
async function startSite(config) {
    const url = `http://localhost:${config.httpPort}`;
    // Reuse only a process previously started by this helper and still serving this API.
    if (fs.existsSync(pidPath)) {
        try {
            const pid = Number(fs.readFileSync(pidPath, 'utf8'));
            if (!Number.isInteger(pid) || pid <= 0) throw new Error();
            process.kill(pid, 0);
            const result = await fetch(`${url}/api/auth/me`, { signal: AbortSignal.timeout(2000) });
            if (result.status === 401 && result.headers.get('content-type')?.includes('application/json')) return url;
        } catch { /* stale PID file; the new listener still detects port conflicts */ }
    }
    // Do not send the admin's password to an unrelated service already on this port.
    await new Promise((resolve, reject) => {
        const probe = net.createServer();
        probe.once('error', () => reject(fail('Site portu baska bir uygulama tarafindan kullaniliyor. Mevcut uygulama durdurulmadi.')));
        probe.listen({ port: config.httpPort, exclusive: true }, () => probe.close(resolve));
    });
    const output = fs.openSync(path.join(backend, '.local-server.log'), 'a');
    const error = fs.openSync(path.join(backend, '.local-server-error.log'), 'a');
    const child = spawn(process.execPath, [path.join(backend, 'server.js')], {
        cwd: backend, env: { ...process.env, ...config.env }, detached: true, windowsHide: true,
        stdio: ['ignore', output, error]
    });
    let launchError;
    child.once('error', () => { launchError = true; });
    child.unref();
    fs.closeSync(output); fs.closeSync(error);
    for (let i = 0; i < 30; i++) {
        await new Promise(resolve => setTimeout(resolve, 300));
        if (launchError || child.exitCode !== null) throw fail('Site baslatilamadi; port baska bir uygulama tarafindan kullaniliyor olabilir.');
        try {
            const response = await fetch(`${url}/api/auth/me`, { signal: AbortSignal.timeout(1000) });
            if (response.status === 401) {
                fs.writeFileSync(pidPath, String(child.pid));
                return url;
            }
        } catch { /* wait for local listener */ }
    }
    if (!launchError && child.exitCode === null) child.kill();
    throw fail('Yerel site zamaninda yanit vermedi.');
}
async function main() {
    phase = 'database'; status('working');
    console.log('Yerel PostgreSQL ve tablolar hazirlaniyor...');
    const { config, pool } = await ensureLocalDatabase();
    let input;
    try {
        const admins = await pool.query("SELECT id, is_active FROM users WHERE role = 'admin' ORDER BY is_active DESC, created_at LIMIT 1");
        if (admins.rows.length && !admins.rows[0].is_active) throw fail('Mevcut admin hesabi pasif. Hesap otomatik olarak degistirilmedi.');
        if (process.argv[2] === '--check') {
            process.exitCode = admins.rows.length ? 0 : 10;
            status(admins.rows.length ? 'configured' : 'needs-admin');
            return;
        }
        if (process.argv[2] === '--start') {
            if (!admins.rows.length) throw fail('Once admin hesabi olusturulmali.');
            const url = await startSite(config);
            status('ready', { url, email: ACCOUNT });
            console.log('Site hazir: ' + url + '/login.html');
            return;
        }
        if (admins.rows.length) throw fail('Bir admin hesabi zaten var. Mevcut hesap veya sifre degistirilmedi.');
        input = await readInput();
        phase = 'admin'; status('working');
        await createInitialAdmin(pool, { email: ACCOUNT, full_name: 'Yerel Yonetici', password: input.adminPassword });
        console.log('Veritabani, takvim ve admin hesabi hazir.');
        phase = 'site'; status('working');
        const url = await startSite(config);
        await verifySite(url, input.adminPassword);
        status('ready', { url, email: ACCOUNT, verified: ['login', 'calendar', 'logout'] });
        console.log('Site hazir: ' + url + '/login.html');
        console.log('Admin e-postasi: ' + ACCOUNT);
    } finally {
        if (input) input.adminPassword = '';
        await pool.end();
    }
}
main().catch(error => {
    const message = error.safeMessage || 'Yerel kurulum tamamlanamadi. Baglanti ve kurulum durumunu kontrol edin.';
    status('error', { message, code: error.code || 'SETUP_FAILED' });
    console.error(message);
    process.exitCode = 1;
});
