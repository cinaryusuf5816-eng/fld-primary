// Owns only this project's local cluster. PostgreSQL's installed data is untouched.
const fs = require('node:fs');
const path = require('node:path');
const net = require('node:net');
const { randomBytes } = require('node:crypto');
const { execFile, spawn } = require('node:child_process');
const { Pool } = require('pg');
const dotenv = require('dotenv');
const { migrate } = require('./migrate');

const backend = path.resolve(__dirname, '..');
const projectRoot = path.dirname(backend);
const clusterRoot = path.join(projectRoot, '.local-postgres');
const dataDirectory = path.join(clusterRoot, 'data');
const markerPath = path.join(clusterRoot, '.fld-owned.json');
const envPath = path.join(backend, '.env');
const binaryDirectory = 'C:\\Program Files\\PostgreSQL\\18\\bin';
const DB_NAME = 'fld_primary';
const DB_USER = 'fld_app';

function fail(message) { return Object.assign(new Error(message), { safeMessage: message }); }
function stageFailure(stage, error) {
    const rawCode = error?.killed ? 'TIMEOUT' : error?.code ?? 'FAILED';
    const code = /^[A-Z0-9_-]+$/i.test(String(rawCode)) ? String(rawCode) : 'FAILED';
    const label = { initdb: 'olusturma', start: 'baslatma', status: 'durum kontrolu', ready: 'hazirlik kontrolu', identity: 'kimlik kontrolu' }[stage] || 'kurulum';
    return Object.assign(fail(`Yerel PostgreSQL ${label} islemi tamamlanamadi. Kod: ${code}.`), {
        code: `LOCAL_POSTGRES_${stage.toUpperCase()}_${code}`, stage
    });
}
function run(executable, args, acceptedCodes = [0], stage = 'setup') {
    return new Promise((resolve, reject) => {
        execFile(executable, args, {
            windowsHide: true, timeout: 60000, maxBuffer: 1024 * 1024,
            env: { ...process.env, PGPASSWORD: '', PGPASSFILE: path.join(clusterRoot, '.unused-pgpass') }
        }, error => {
            const code = error ? error.code : 0;
            if (acceptedCodes.includes(code)) resolve(code);
            else reject(stageFailure(stage, error));
        });
    });
}
function readConfig() {
    const source = fs.readFileSync(fs.existsSync(envPath) ? envPath : path.join(backend, '.env.example'), 'utf8');
    const env = dotenv.parse(source);
    if (env.DATABASE_URL || process.env.DATABASE_URL || env.NODE_ENV === 'production' || process.env.NODE_ENV === 'production' ||
        !['localhost', '127.0.0.1'].includes(env.DB_HOST || 'localhost') || (env.DB_NAME && env.DB_NAME !== DB_NAME)) {
        throw fail('Bu arac yalnizca yerel fld_primary veritabani icindir. Mevcut ayarlar degistirilmedi.');
    }
    const port = Number(env.DB_PORT || 5432);
    const httpPort = Number(env.PORT || 3000);
    if (![port, httpPort].every(n => Number.isInteger(n) && n > 0 && n <= 65535)) throw fail('Gecersiz port ayari.');
    return { source, env, port, httpPort };
}
function writeConfig(config, password) {
    const values = { DB_HOST: '127.0.0.1', DB_PORT: String(config.port), DB_NAME, DB_USER,
        DB_PASSWORD: password, NODE_ENV: 'development', PORT: String(config.httpPort), HOST: '127.0.0.1' };
    let source = config.source;
    for (const [key, value] of Object.entries(values)) {
        if (key === 'DB_PASSWORD' && config.env.DB_USER === DB_USER && config.env.DB_PASSWORD === password) continue;
        const pattern = new RegExp(`^\\s*${key}\\s*=.*$`, 'gm');
        source = pattern.test(source) ? source.replace(pattern, () => `${key}=${value}`) : `${source.trimEnd()}\n${key}=${value}\n`;
    }
    fs.writeFileSync(envPath, source, { encoding: 'utf8', mode: 0o600 });
    return { source, env: { ...config.env, ...values }, port: config.port, httpPort: config.httpPort };
}
function freePort(port) {
    return new Promise((resolve, reject) => {
        const probe = net.createServer();
        probe.once('error', () => reject(fail('PostgreSQL portu zaten kullaniliyor. Mevcut veritabani durdurulmadi veya degistirilmedi.')));
        probe.listen({ host: '127.0.0.1', port, exclusive: true }, () => probe.close(resolve));
    });
}
function poolFor(config, database, user, password) {
    const pool = new Pool({ host: '127.0.0.1', port: config.port, database, user, password, max: 2, connectionTimeoutMillis: 5000 });
    pool.on('error', () => {});
    return pool;
}
function sameStartTime(pidSeconds, querySeconds) {
    const actual = Number(querySeconds);
    // PostgreSQL captures the PID-file and SQL timestamps at different startup
    // stages. Allow the observed one-second skew; larger mismatches still fail.
    return Number.isSafeInteger(pidSeconds) && pidSeconds > 0 && Number.isSafeInteger(actual) &&
        actual >= pidSeconds && actual - pidSeconds <= 1;
}
async function reuseRunningCluster(config) {
    const probe = poolFor(config, DB_NAME, DB_USER, config.env.DB_PASSWORD);
    try {
        const result = await probe.query({
            text: `SELECT current_user AS user_name, current_database() AS database_name,
                floor(extract(epoch FROM pg_postmaster_start_time()))::bigint AS started_at,
                inet_server_port() AS port, host(inet_server_addr()) AS host`,
            query_timeout: 5000
        });
        const pidFile = path.join(dataDirectory, 'postmaster.pid');
        if (!fs.existsSync(pidFile) || fs.lstatSync(pidFile).isSymbolicLink()) throw stageFailure('identity', { code: 'PID_FILE' });
        const lines = fs.readFileSync(pidFile, 'utf8').split(/\r?\n/);
        const pid = Number(lines[0]);
        const startedAt = Number(lines[2]);
        const pidPort = Number(lines[3]);
        const identity = result.rows[0];
        if (!Number.isSafeInteger(pid) || pid <= 0 || !lines[1] ||
            path.resolve(lines[1]).toLowerCase() !== dataDirectory.toLowerCase() ||
            !Number.isSafeInteger(startedAt) || startedAt <= 0 || pidPort !== config.port ||
            identity?.user_name !== DB_USER || identity.database_name !== DB_NAME ||
            !sameStartTime(startedAt, identity.started_at) || identity.port !== config.port || identity.host !== '127.0.0.1') {
            throw stageFailure('identity', { code: 'MISMATCH' });
        }
        return true;
    } catch (error) {
        // Only an absent listener allows a normal status/start attempt. A server
        // that rejects our credentials or fails ownership checks is never reset.
        if (error.code === 'ECONNREFUSED') return false;
        throw error.safeMessage ? error : stageFailure('identity', error);
    } finally { await probe.end(); }
}
function readMarker() {
    if (!fs.existsSync(clusterRoot)) return null;
    if (fs.lstatSync(clusterRoot).isSymbolicLink()) throw fail('Yerel veritabani klasoru bir baglanti olamaz.');
    if (!fs.existsSync(markerPath)) {
        if (fs.readdirSync(clusterRoot).length) throw fail('Taninmayan yerel veritabani klasoru bulundu. Mevcut dosyalar degistirilmedi.');
        return null;
    }
    let marker;
    try { marker = JSON.parse(fs.readFileSync(markerPath, 'utf8')); } catch { throw fail('Yerel veritabani sahiplik kaydi gecersiz.'); }
    if (marker.version !== 1 || marker.projectRoot !== projectRoot || marker.database !== DB_NAME || marker.user !== DB_USER) {
        throw fail('Yerel veritabani bu projeye ait olarak dogrulanamadi.');
    }
    if (!marker.complete || !fs.existsSync(path.join(dataDirectory, 'PG_VERSION')) || fs.lstatSync(dataDirectory).isSymbolicLink()) {
        throw fail('Onceki yerel veritabani kurulumu tamamlanmamis. Mevcut dosyalar korundu; kurulumun kontrol edilmesi gerekiyor.');
    }
    return marker;
}
function writeMarker(complete, port) {
    fs.writeFileSync(markerPath, JSON.stringify({ version: 1, projectRoot, database: DB_NAME, user: DB_USER, port, complete }, null, 2));
}
async function startCluster(config) {
    // Start in this same Windows account; no service, privilege change or token rewrite.
    const output = fs.openSync(path.join(clusterRoot, 'postgres.log'), 'a');
    let child;
    let launchError;
    try {
        child = spawn(path.join(binaryDirectory, 'postgres.exe'), ['-D', dataDirectory, '-h', '127.0.0.1', '-p', String(config.port)], {
            cwd: clusterRoot, detached: true, windowsHide: true,
            env: { ...process.env, PGPASSWORD: '', PGPASSFILE: path.join(clusterRoot, '.unused-pgpass') },
            stdio: ['ignore', output, output]
        });
        child.once('error', error => { launchError = error; });
        child.unref();
    } catch (error) {
        throw stageFailure('start', error);
    } finally { fs.closeSync(output); }
    const deadline = Date.now() + 45000;
    while (Date.now() < deadline) {
        if (launchError) throw stageFailure('start', launchError);
        if (child.exitCode !== null || child.signalCode !== null) throw stageFailure('start', { code: child.exitCode ?? 'SIGNAL' });
        const ready = await run(path.join(binaryDirectory, 'pg_isready.exe'), [
            '-h', '127.0.0.1', '-p', String(config.port), '-d', 'postgres', '-U', 'postgres', '-t', '1'
        ], [0, 1, 2], 'ready');
        if (launchError) throw stageFailure('start', launchError);
        if (child.exitCode !== null || child.signalCode !== null) throw stageFailure('start', { code: child.exitCode ?? 'SIGNAL' });
        if (ready === 0) return;
        await new Promise(resolve => setTimeout(resolve, 300));
    }
    // Preserve the cluster and any still-starting process for inspection; never force-kill PostgreSQL.
    throw stageFailure('start', { killed: true });
}

async function ensureLocalDatabase() {
    let app;
    try {
        if (process.platform !== 'win32') throw fail('Bu yerel kurulum Windows icindir.');
        for (const name of ['initdb.exe', 'pg_ctl.exe', 'postgres.exe', 'pg_isready.exe']) {
            if (!fs.existsSync(path.join(binaryDirectory, name))) throw fail('PostgreSQL 18 program dosyalari bulunamadi. Once kurulumu tamamlayin.');
        }
        let config = readConfig();
        const marker = readMarker();
        if (marker) {
            if (config.env.DB_USER !== DB_USER || config.env.DB_NAME !== DB_NAME || !config.env.DB_PASSWORD || marker.port !== config.port) {
                throw fail('Mevcut yerel veritabani icin bu projenin baglanti ayarlari gerekli. Mevcut sifreler degistirilmedi.');
            }
            // Windows can deny pg_ctl process inspection across tokens even when
            // our existing cluster is healthy. Authenticate and verify it first.
            if (!await reuseRunningCluster(config)) {
                const running = await run(path.join(binaryDirectory, 'pg_ctl.exe'), ['-D', dataDirectory, 'status'], [0, 3], 'status');
                if (running === 3) { await freePort(config.port); await startCluster(config); }
            }
            config = writeConfig(config, config.env.DB_PASSWORD);
        } else {
            await freePort(config.port);
            fs.mkdirSync(clusterRoot, { recursive: true });
            // Inherit the private project ACLs, retaining access for its interactive owner.
            // The bootstrap password file is removed immediately after initdb.
            writeMarker(false, config.port);
            let postgresPassword = randomBytes(32).toString('hex');
            let appPassword = randomBytes(32).toString('hex');
            const passwordFile = path.join(clusterRoot, `.bootstrap-${randomBytes(12).toString('hex')}.tmp`);
            let control;
            try {
                fs.writeFileSync(passwordFile, `${postgresPassword}\n`, { encoding: 'utf8', flag: 'wx', mode: 0o600 });
                try {
                    await run(path.join(binaryDirectory, 'initdb.exe'), ['-D', dataDirectory, '--locale=C', '--encoding=UTF8',
                        '--auth=scram-sha-256', '-U', 'postgres', `--pwfile=${passwordFile}`], [0], 'initdb');
                } finally {
                    if (fs.existsSync(passwordFile)) fs.unlinkSync(passwordFile);
                }
                await startCluster(config);
                control = poolFor(config, 'postgres', 'postgres', postgresPassword);
                await control.query('SELECT 1');
                // Only cryptographically random hexadecimal values enter this fixed DDL.
                await control.query(`CREATE ROLE fld_app LOGIN NOSUPERUSER NOCREATEDB NOCREATEROLE NOREPLICATION NOBYPASSRLS PASSWORD '${appPassword}'`);
                await control.query('CREATE DATABASE fld_primary OWNER fld_app');
                config = writeConfig(config, appPassword);
                writeMarker(true, config.port);
            } finally {
                postgresPassword = ''; appPassword = '';
                if (fs.existsSync(passwordFile)) fs.unlinkSync(passwordFile);
                if (control) await control.end();
            }
        }
        app = poolFor(config, DB_NAME, DB_USER, config.env.DB_PASSWORD);
        await app.query('SELECT 1');
        await migrate(app);
        return { config, pool: app };
    } catch (error) {
        if (app) await app.end();
        throw error.safeMessage ? error : fail('Yerel veritabani hazirlanamadi. Mevcut veriler korundu; baglanti ve kurulum ayarlarini kontrol edin.');
    }
}

module.exports = { ensureLocalDatabase, sameStartTime };
