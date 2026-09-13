// Temporary loopback-only first-admin setup. No changes to the portal frontend.
const http = require('node:http');
const path = require('node:path');
const fs = require('node:fs');
const { randomBytes, timingSafeEqual } = require('node:crypto');
const { spawn } = require('node:child_process');
const { validPassword } = require('../auth/passwords');

function provision(password) {
    return new Promise((resolve, reject) => {
        const child = spawn(process.execPath, [path.join(__dirname, 'setup-local.js')], {
            cwd: path.resolve(__dirname, '..'), windowsHide: true,
            stdio: ['pipe', 'ignore', 'ignore']
        });
        child.once('error', reject);
        child.once('exit', code => {
            if (code !== 0) return reject(new Error('SETUP_FAILED'));
            try {
                const status = JSON.parse(fs.readFileSync(path.join(__dirname, '..', '.local-setup-status.json'), 'utf8'));
                const url = new URL(status.url);
                if (status.state !== 'ready' || url.protocol !== 'http:' || url.hostname !== 'localhost') throw new Error();
                resolve(url.origin + '/login.html');
            } catch { reject(new Error('SETUP_FAILED')); }
        });
        child.stdin.on('error', reject);
        child.stdin.end(JSON.stringify({ adminPassword: password }));
        password = '';
    });
}

function createSetupServer({ runSetup = provision, lifetimeMs = 20 * 60 * 1000 } = {}) {
    const token = randomBytes(32).toString('hex');
    const nonce = randomBytes(24).toString('base64');
    const expiresAt = Date.now() + lifetimeMs;
    let busy = false;
    let complete = false;
    let expiry;
    const server = http.createServer(async (req, res) => {
        const origin = `http://127.0.0.1:${server.address().port}`;
        res.setHeader('Cache-Control', 'no-store');
        res.setHeader('X-Content-Type-Options', 'nosniff');
        res.setHeader('Referrer-Policy', 'no-referrer');
        res.setHeader('X-Frame-Options', 'DENY');
        res.setHeader('Content-Security-Policy', `default-src 'none'; script-src 'nonce-${nonce}'; style-src 'nonce-${nonce}'; connect-src 'self'; form-action 'none'; frame-ancestors 'none'; base-uri 'none'`);
        function json(status, body) {
            res.writeHead(status, { 'Content-Type': 'application/json; charset=utf-8' });
            res.end(JSON.stringify(body));
        }
        if (req.headers.host !== new URL(origin).host) return json(403, { error: 'Geçersiz adres.' });
        if (Date.now() > expiresAt) return json(410, { error: 'Kurulum süresi doldu. Kurulumu yeniden açın.' });
        if (['GET', 'HEAD'].includes(req.method) && req.url === '/') {
            res.writeHead(200, { 'Content-Type': 'text/html; charset=utf-8' });
            if (req.method === 'HEAD') return res.end();
            return res.end(`<!doctype html><html lang="tr"><meta charset="utf-8"><meta name="viewport" content="width=device-width,initial-scale=1"><title>FLD Primary · İlk kurulum</title>
<style nonce="${nonce}">*{box-sizing:border-box}body{margin:0;min-height:100vh;display:grid;place-items:center;background:#f6f2f8;color:#292030;font:16px/1.5 system-ui,sans-serif;padding:24px}main{width:min(100%,440px);background:#fff;padding:32px;border-radius:20px;box-shadow:0 14px 48px #39213e14}h1{font-size:26px;line-height:1.2;margin:8px 0 16px}.brand{color:#74408d;font-weight:700}p{color:#655b6a}label{display:block;margin-top:18px;font-weight:600}input,button{font:inherit;width:100%;padding:12px;border-radius:9px}input{border:1px solid #c8bccc;margin-top:6px}button{margin-top:24px;border:0;background:#74408d;color:white;cursor:pointer;font-weight:600}button:disabled{opacity:.6;cursor:wait}input:focus-visible,button:focus-visible{outline:3px solid #c4a6d4;outline-offset:2px}#status{min-height:24px}a{color:#74408d}</style>
<main><div class="brand">FLD Primary</div><h1>Yönetici şifreni belirle</h1><p>Veritabanın hazır. Bu bilgisayarda kullanacağın ilk yönetici hesabı için şifreni seç.</p><p>E-posta: <strong>admin@fld.local</strong></p>
<form id="setup"><label for="password">Şifre</label><input id="password" type="password" autocomplete="new-password" minlength="12" maxlength="128" required aria-describedby="hint"><div id="hint">En az 12 karakter.</div><label for="confirmation">Şifreyi tekrar yaz</label><input id="confirmation" type="password" autocomplete="new-password" minlength="12" maxlength="128" required><button id="submit" type="submit">Hesabı oluştur ve siteyi aç</button></form><p id="status" role="status" aria-live="polite"></p></main>
<script nonce="${nonce}">const form=document.getElementById('setup'),button=document.getElementById('submit'),status=document.getElementById('status');form.addEventListener('submit',async event=>{event.preventDefault();const first=document.getElementById('password'),second=document.getElementById('confirmation');if(first.value!==second.value){status.textContent='Şifreler aynı değil. Tekrar kontrol et.';return}button.disabled=true;status.textContent='Hesap oluşturuluyor ve site kontrol ediliyor…';let password=first.value;first.value='';second.value='';try{const response=await fetch('/setup',{method:'POST',headers:{'Content-Type':'application/json','X-FLD-Setup':'${token}'},body:JSON.stringify({password})});password='';const result=await response.json();if(!response.ok)throw new Error(result.error);form.hidden=true;status.textContent='Hazır. Giriş sayfası açılıyor…';location.assign(result.url)}catch(error){password='';status.textContent=error.message||'Kurulum tamamlanamadı.';button.disabled=false}});</script></html>`);
        }
        if (req.method !== 'POST' || req.url !== '/setup') return json(404, { error: 'Sayfa bulunamadı.' });
        const supplied = req.headers['x-fld-setup'];
        const sameToken = typeof supplied === 'string' && /^[0-9a-f]{64}$/.test(supplied) && timingSafeEqual(Buffer.from(supplied), Buffer.from(token));
        if (req.headers.origin !== origin || req.headers['content-type']?.split(';')[0].trim() !== 'application/json' || !sameToken || req.headers['sec-fetch-site'] === 'cross-site') {
            return json(403, { error: 'Bu isteğe izin verilmiyor.' });
        }
        if (complete || busy) return json(409, { error: 'Kurulum zaten tamamlandı veya devam ediyor.' });
        busy = true;
        let input;
        let body = '';
        try {
            req.setEncoding('utf8');
            for await (const chunk of req) {
                body += chunk;
                if (body.length > 4096) return json(413, { error: 'Girdi çok uzun.' });
            }
            try { input = JSON.parse(body); } catch { return json(400, { error: 'Geçersiz girdi.' }); }
            body = '';
            if (!input || typeof input !== 'object' || Object.keys(input).some(key => key !== 'password') || !validPassword(input.password)) {
                return json(400, { error: 'Şifre 12–128 karakter olmalı.' });
            }
            const loginUrl = await runSetup(input.password);
            complete = true;
            json(200, { url: loginUrl || 'http://localhost:3000/login.html' });
            // Allow the response to finish before closing this temporary listener.
            setTimeout(() => server.close(), 1000).unref();
        } catch {
            json(500, { error: 'Kurulum tamamlanamadı. Bağlantı veya mevcut hesap kontrol edilmeli.' });
        } finally {
            busy = false;
            body = '';
            if (input) input.password = '';
        }
    });
    server.requestTimeout = 30000;
    server.headersTimeout = 10000;
    server.on('listening', () => { expiry = setTimeout(() => server.close(), lifetimeMs); expiry.unref(); });
    server.on('close', () => clearTimeout(expiry));
    return server;
}
if (require.main === module) {
    const server = createSetupServer();
    server.once('error', () => { console.error('Yerel kurulum sayfasi acilamadi.'); process.exitCode = 1; });
    server.listen(3001, '127.0.0.1', () => console.log('Kurulum: http://127.0.0.1:3001'));
}
module.exports = { createSetupServer };
