const test = require('node:test');
const assert = require('node:assert/strict');
const http = require('node:http');
const { once } = require('node:events');
const { createSetupServer } = require('../scripts/setup-browser');

const TEST_PASSWORD = 'Local test password 123!';

async function fixture(t, options = {}) {
    const server = createSetupServer({ lifetimeMs: 5000, ...options });
    server.listen(0, '127.0.0.1');
    await once(server, 'listening');
    const port = server.address().port;
    const origin = `http://127.0.0.1:${port}`;
    t.after(async () => {
        server.closeAllConnections();
        await new Promise(resolve => server.close(resolve));
    });
    function request({ method = 'GET', pathname = '/', headers = {}, body } = {}) {
        return new Promise((resolve, reject) => {
            const req = http.request({ hostname: '127.0.0.1', port, path: pathname, method,
                headers: { Host: `127.0.0.1:${port}`, ...headers }, agent: false }, res => {
                let content = '';
                res.setEncoding('utf8');
                res.on('data', chunk => { content += chunk; });
                res.on('end', () => resolve({ status: res.statusCode, headers: res.headers, body: content }));
            });
            req.on('error', reject);
            req.setTimeout(3000, () => req.destroy(new Error('Test HTTP timeout')));
            req.end(body);
        });
    }
    async function form() {
        const response = await request();
        assert.equal(response.status, 200);
        const token = response.body.match(/['"]X-FLD-Setup['"]\s*:\s*['"]([a-f0-9]{64})['"]/i)?.[1];
        assert.ok(token, 'setup form must supply its in-memory CSRF token');
        return { response, token };
    }
    function submit(token, overrides = {}) {
        return request({ method: 'POST', pathname: '/setup', body: JSON.stringify({ password: TEST_PASSWORD }),
            ...overrides, headers: { Origin: origin, 'Content-Type': 'application/json', 'X-FLD-Setup': token, ...overrides.headers } });
    }
    return { server, origin, request, form, submit };
}

test('setup form and HEAD carry strict browser protections without caching', async t => {
    let calls = 0;
    const f = await fixture(t, { runSetup: async () => { calls++; } });
    const { response } = await f.form();
    assert.equal(response.headers['cache-control'], 'no-store');
    assert.equal(response.headers['x-frame-options'], 'DENY');
    assert.equal(response.headers['x-content-type-options'], 'nosniff');
    assert.equal(response.headers['referrer-policy'], 'no-referrer');
    const csp = response.headers['content-security-policy'];
    assert.match(csp, /default-src 'none'/);
    assert.match(csp, /frame-ancestors 'none'/);
    assert.match(csp, /base-uri 'none'/);
    const nonce = csp.match(/script-src 'nonce-([^']+)'/)?.[1];
    assert.ok(nonce);
    assert.ok(response.body.includes(`<script nonce="${nonce}">`));
    assert.doesNotMatch(csp, /unsafe-inline|unsafe-eval/);
    const head = await f.request({ method: 'HEAD' });
    assert.equal(head.status, 200);
    assert.equal(head.body, '');
    assert.equal(head.headers['cache-control'], 'no-store');
    assert.equal(calls, 0);
});

test('Host, Origin, JSON and token boundaries reject requests before invoking setup', async t => {
    let calls = 0;
    const f = await fixture(t, { runSetup: async () => { calls++; } });
    const { token } = await f.form();
    const wrongHost = await f.request({ headers: { Host: 'evil.example' } });
    assert.equal(wrongHost.status, 403);
    const attempts = [
        { headers: { Host: 'evil.example' } },
        { headers: { Origin: 'https://evil.example' } },
        { headers: { Origin: '' } },
        { headers: { 'Content-Type': 'text/plain' } },
        { headers: { 'X-FLD-Setup': '' } },
        { headers: { 'X-FLD-Setup': '0'.repeat(64) } },
        // Same character count, different UTF-8 byte count must not crash the server.
        { headers: { 'X-FLD-Setup': '\u00e9'.repeat(64) } },
        { headers: { 'Sec-Fetch-Site': 'cross-site' } }
    ];
    for (const attempt of attempts) {
        const response = await f.submit(token, attempt);
        assert.equal(response.status, 403);
        assert.equal(response.headers['cache-control'], 'no-store');
        assert.equal(response.headers['access-control-allow-origin'], undefined);
        assert.ok(!response.body.includes(TEST_PASSWORD));
    }
    assert.equal((await f.request({ pathname: '/setup' })).status, 404);
    assert.equal(calls, 0);
    assert.equal((await f.request()).status, 200, 'invalid token cannot terminate the listener');
});

test('malformed, oversized and invalid payloads never reach account creation', async t => {
    let calls = 0;
    const f = await fixture(t, { runSetup: async () => { calls++; } });
    const { token } = await f.form();
    for (const body of ['{', 'null', '[]', '{}', JSON.stringify({ password: 'short' }),
        JSON.stringify({ password: TEST_PASSWORD, role: 'admin' })]) {
        const response = await f.submit(token, { body });
        assert.equal(response.status, 400);
        assert.ok(!response.body.includes(TEST_PASSWORD));
    }
    const oversized = await f.submit(token, { body: JSON.stringify({ password: 'x'.repeat(5000) }) });
    assert.equal(oversized.status, 413);
    assert.equal(calls, 0);
});

test('concurrent and repeated valid submissions invoke setup exactly once', async t => {
    let calls = 0;
    let unlock;
    let announce;
    const started = new Promise(resolve => { announce = resolve; });
    const gate = new Promise(resolve => { unlock = resolve; });
    const f = await fixture(t, { runSetup: async password => {
        assert.equal(password, TEST_PASSWORD);
        calls++;
        announce();
        await gate;
        return 'http://localhost:3000/login.html';
    } });
    const { token } = await f.form();
    const first = f.submit(token);
    try {
        await started;
        assert.equal((await f.submit(token)).status, 409);
        assert.equal(calls, 1);
    } finally { unlock(); }
    const success = await first;
    assert.equal(success.status, 200);
    assert.match(JSON.parse(success.body).url, /^http:\/\/(localhost|127\.0\.0\.1):\d+\/login\.html$/);
    assert.ok(!success.body.includes(TEST_PASSWORD));
    assert.equal((await f.submit(token)).status, 409);
    assert.equal(calls, 1);
});

test('runner failures return a static error and do not reveal passwords or internal errors', async t => {
    const f = await fixture(t, { runSetup: async password => { throw new Error(`internal failure containing ${password}`); } });
    const { token } = await f.form();
    const response = await f.submit(token);
    assert.equal(response.status, 500);
    assert.ok(!response.body.includes(TEST_PASSWORD));
    assert.doesNotMatch(response.body, /internal failure/);
    assert.equal(response.headers['cache-control'], 'no-store');
});

test('expiry closes the unused listener without invoking setup', async t => {
    let calls = 0;
    const f = await fixture(t, { lifetimeMs: 100, runSetup: async () => { calls++; } });
    const closed = once(f.server, 'close');
    await closed;
    assert.equal(f.server.listening, false);
    await assert.rejects(f.request(), { code: 'ECONNREFUSED' });
    assert.equal(calls, 0);
});

test('a setup accepted before expiry may finish successfully after the listener closes', async t => {
    let unlock;
    let announce;
    const started = new Promise(resolve => { announce = resolve; });
    const gate = new Promise(resolve => { unlock = resolve; });
    const f = await fixture(t, { lifetimeMs: 300, runSetup: async () => {
        announce();
        await gate;
        return 'http://localhost:3000/login.html';
    } });
    const { token } = await f.form();
    const responsePromise = f.submit(token);
    try {
        await started;
        await new Promise(resolve => setTimeout(resolve, 350));
        assert.equal(f.server.listening, false);
    } finally { unlock(); }
    assert.equal((await responsePromise).status, 200);
});
