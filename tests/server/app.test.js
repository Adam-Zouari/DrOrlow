'use strict';

const assert = require('node:assert/strict');
const test = require('node:test');
const { once } = require('node:events');
const { createApp } = require('../../server/app');
const { loadConfig } = require('../../server/config');
const { hashPassword, verifyPassword } = require('../../server/password');
const { validateSubmission } = require('../../server/validation');

const valid = {
  name: '  Amira  ', surname: 'Friend', gender: 'Prefer not to say',
  email: 'Amira@Example.com', pemail: '', birthday: '',
  details: 'Hello, friend.', interests: 'Music', join_reason: 'I would like to help.',
  sports: 'yes', science: 'yes', r1: 'cute'
};
const adminPassword = 'A private test password of sufficient length';
const adminConfig = { ...loadConfig({}), superPassword: adminPassword };

async function withServer(t, options = {}) {
  const app = createApp({ config: loadConfig({}), logger: { error() {} }, ...options });
  const server = app.listen(0, '127.0.0.1');
  await once(server, 'listening');
  t.after(async () => {
    server.closeAllConnections();
    await new Promise((resolve, reject) => server.close((error) => error ? reject(error) : resolve()));
  });
  const base = `http://127.0.0.1:${server.address().port}`;
  const request = (route, options) => fetch(base + route, options);
  const jsonPost = (route, body, headers = {}) => request(route, {
    method: 'POST', headers: { 'Content-Type': 'application/json', ...headers },
    body: JSON.stringify(body), redirect: 'manual'
  });
  return {
    base, request,
    submit: (body = valid, headers = {}) => jsonPost('/submit', body, headers),
    login: async (password = adminPassword, headers = {}) => {
      const response = await jsonPost('/api/super/login', { password }, headers);
      return {
        response, body: await response.json(),
        cookie: (response.headers.get('set-cookie') || '').split(';')[0]
      };
    }
  };
}

test('serves original home, assets, form, and health without database credentials', async (t) => {
  const { request } = await withServer(t);
  const response = await request('/');
  assert.equal(response.status, 200);
  assert.match(await response.text(), /Dr Orlow/);
  assert.equal(response.headers.get('x-content-type-options'), 'nosniff');
  assert.match(response.headers.get('content-security-policy'), /script-src 'self'/);
  assert.doesNotMatch(response.headers.get('content-security-policy'), /unsafe-inline/);
  assert.equal(response.headers.get('x-powered-by'), null);
  for (const [route, contentType] of [
    ['/assets/css/common.css', /text\/css/],
    ['/assets/js/ambient.js', /javascript/],
    ['/assets/images/Octopus1.png', /image\/png/],
    ['/assets/fonts/Beautiful.ttf', /font\/ttf/]
  ]) {
    const asset = await request(route);
    assert.equal(asset.status, 200, route);
    assert.match(asset.headers.get('content-type'), contentType, route);
  }
  const form = await request('/join%20me.html');
  assert.equal(form.status, 200);
  assert.doesNotMatch(await form.text(), /type="password"|name="id"|Sign up/);
  assert.deepEqual(await (await request('/health')).json(), { status: 'ok', submissions: 'unavailable' });
});

test('does not expose server code, configuration, or repository metadata', async (t) => {
  const { request } = await withServer(t);
  for (const route of ['/server/app.js', '/.env', '/.git/config', '/..%2fserver/app.js']) {
    const response = await request(route);
    assert.equal(response.status, 404, route);
    assert.match(await response.text(), /href="\/assets\/css\/common\.css"/);
  }
});

test('valid form persists all normalized fields without account credentials', async (t) => {
  let saved;
  const { submit } = await withServer(t, { repository: { async createSubmission(form) { saved = form; } } });
  const response = await submit({ ...valid, id: 'obsolete', psw: 'ignored', conf: 'ignored' });
  assert.equal(response.status, 201);
  assert.equal((await response.json()).redirect, '/Home.html?submitted=1');
  assert.equal(response.headers.get('cache-control'), 'no-store');
  assert.equal(saved.name, 'Amira');
  assert.equal(saved.email, 'amira@example.com');
  assert.equal(saved.birthday, null);
  assert.equal(saved.pemail, null);
  assert.equal(saved.details, valid.details);
  assert.equal(saved.interests, valid.interests);
  assert.equal(saved.joinReason, valid.join_reason);
  assert.equal(saved.rating, 'cute');
  assert.equal(saved.sports, true);
  assert.equal(saved.science, true);
  assert.equal(saved.arts, false);
  for (const removed of ['id', 'identifier', 'password', 'psw', 'conf']) assert.equal(saved[removed], undefined);
});

test('native HTML forms work without JavaScript and redirect with 303', async (t) => {
  const { request } = await withServer(t, { repository: { async createSubmission() {} } });
  const response = await request('/submit', { method: 'POST', body: new URLSearchParams(valid), redirect: 'manual' });
  assert.equal(response.status, 303);
  assert.equal(response.headers.get('location'), '/Home.html?submitted=1');
});

test('invalid and repeated values are rejected before database access', async (t) => {
  let writes = 0;
  const { submit } = await withServer(t, { repository: { async createSubmission() { writes += 1; } } });
  const response = await submit({ ...valid, name: ['one', 'two'], birthday: '2026-02-30', email: 'invalid', join_reason: '   ' });
  assert.equal(response.status, 422);
  const body = await response.json();
  for (const field of ['name', 'birthday', 'email', 'join_reason']) assert.ok(body.errors[field]);
  assert.equal(writes, 0);
});

test('unconfigured forms and database outages return honest unavailable responses', async (t) => {
  assert.equal((await (await withServer(t)).submit()).status, 503);
  const broken = await withServer(t, { repository: {
    async createSubmission() { throw Object.assign(new Error('private query details'), { code: 'ECONNREFUSED' }); }
  } });
  const response = await broken.submit();
  assert.equal(response.status, 503);
  assert.doesNotMatch(await response.text(), /private query|ECONNREFUSED/);
});

test('cross-site form posts and unsupported content types never write data', async (t) => {
  let writes = 0;
  const { submit, request } = await withServer(t, { repository: { async createSubmission() { writes += 1; } } });
  assert.equal((await submit(valid, { Origin: 'https://another-site.example' })).status, 403);
  assert.equal((await submit(valid, { 'Sec-Fetch-Site': 'cross-site' })).status, 403);
  assert.equal((await request('/submit', { method: 'POST', body: 'raw data' })).status, 415);
  assert.equal(writes, 0);
});

test('same-origin requests honor an explicitly configured public origin', async (t) => {
  const { submit, base } = await withServer(t, { repository: { async createSubmission() {} } });
  assert.equal((await submit(valid, { Origin: base })).status, 201);
  const proxied = await withServer(t, {
    config: { ...loadConfig({}), siteOrigin: 'https://drorlow.example' },
    repository: { async createSubmission() {} }
  });
  assert.equal((await proxied.submit(valid, { Origin: 'https://drorlow.example' })).status, 201);
});

test('limits request size and handles malformed JSON without leaking internals', async (t) => {
  const { submit, request } = await withServer(t);
  assert.equal((await submit({ ...valid, details: 'x'.repeat(100000) })).status, 413);
  const response = await request('/submit', {
    method: 'POST', headers: { 'Content-Type': 'application/json' }, body: '{"invalid"'
  });
  assert.equal(response.status, 400);
  assert.doesNotMatch(await response.text(), /SyntaxError|stack|node_modules/);
});

test('unsupported charsets and compression are safe client errors rather than server failures', async (t) => {
  const logged = [];
  let writes = 0;
  const { request } = await withServer(t, {
    logger: { error(...details) { logged.push(details); } },
    repository: { async createSubmission() { writes += 1; } }
  });
  for (const [headers, expected] of [
    [{ 'Content-Type': 'application/json; charset=iso-8859-1' }, 415],
    [{ 'Content-Type': 'application/json', 'Content-Encoding': 'unsupported' }, 415],
    [{ 'Content-Type': 'application/json', 'Content-Encoding': 'gzip' }, 400]
  ]) {
    const response = await request('/submit', { method: 'POST', headers, body: JSON.stringify(valid) });
    assert.equal(response.status, expected);
    assert.doesNotMatch(await response.text(), /node_modules|stack|Z_DATA_ERROR|unsupported charset/i);
  }
  assert.equal(writes, 0);
  assert.deepEqual(logged, []);
});

test('case-insensitive private routes keep their JSON error contract', async (t) => {
  const { request } = await withServer(t);
  for (const route of ['/API/SUPER/FORMS', '/Api/Super/Forms?page=0']) {
    const response = await request(route);
    assert.equal(response.status, 401);
    assert.match(response.headers.get('content-type'), /application\/json/);
    assert.equal(typeof (await response.json()).message, 'string');
  }
});

test('rate-limits submissions and resets after the window expires', async (t) => {
  let clock = Date.now();
  const { submit } = await withServer(t, {
    now: () => clock, rateLimit: { max: 2, windowMs: 1000 },
    repository: { async createSubmission() {} }
  });
  assert.equal((await submit()).status, 201);
  assert.equal((await submit()).status, 201);
  const limited = await submit();
  assert.equal(limited.status, 429);
  assert.equal(limited.headers.get('retry-after'), '1');
  clock += 1001;
  assert.equal((await submit()).status, 201);
});

test('validation checks real dates, optional fields, and field lengths', () => {
  const today = new Date('2026-10-22T12:00:00.000Z');
  for (const birthday of ['2026-02-29', '2026-10-23', '2025-13-01', '1899-12-31']) {
    assert.ok(validateSubmission({ ...valid, birthday }, today).errors.birthday, birthday);
  }
  assert.equal(validateSubmission({ ...valid, birthday: '2024-02-29' }, today).errors.birthday, undefined);
  assert.deepEqual(validateSubmission(valid, today).errors, {});
  assert.ok(validateSubmission({ ...valid, details: 'x'.repeat(2001) }, today).errors.details);
  assert.ok(validateSubmission({ ...valid, sports: ['yes', 'no'] }, today).errors.sports);
  assert.ok(validateSubmission({ ...valid, r1: 'unknown' }, today).errors.r1);
});

test('private data never reaches an unauthenticated visitor or forged session', async (t) => {
  let reads = 0;
  const { request } = await withServer(t, {
    config: adminConfig,
    adminRepository: { async listSubmissions() { reads += 1; return { forms: [valid], total: 1 }; } }
  });
  assert.deepEqual(await (await request('/api/super/session')).json(), { authenticated: false });
  for (const cookie of ['', `super_orlow_session=${'a'.repeat(43)}`, 'super_orlow_session=malformed']) {
    const response = await request('/api/super/forms', { headers: { Cookie: cookie } });
    assert.equal(response.status, 401);
    assert.equal(response.headers.get('cache-control'), 'no-store');
    assert.doesNotMatch(await response.text(), /Amira|example.com|I would like to help/);
  }
  assert.equal(reads, 0);
});

test('login verifies the password and returns a private bounded session cookie', async (t) => {
  const { login, request } = await withServer(t, { config: adminConfig });
  const wrong = await login('wrong password');
  assert.equal(wrong.response.status, 401);
  assert.equal(wrong.cookie, '');
  const correct = await login();
  assert.equal(correct.response.status, 201);
  assert.equal(correct.body.authenticated, true);
  assert.match(correct.body.csrfToken, /^[A-Za-z0-9_-]{43}$/);
  assert.match(correct.cookie, /^super_orlow_session=[A-Za-z0-9_-]{43}$/);
  const attributes = correct.response.headers.get('set-cookie');
  for (const attribute of ['HttpOnly', 'SameSite=Strict', 'Path=/api/super', 'Max-Age=43200']) assert.ok(attributes.includes(attribute));
  assert.doesNotMatch(attributes, /Domain=/);
  assert.deepEqual(await (await request('/api/super/session', { headers: { Cookie: correct.cookie } })).json(), correct.body);
});

test('private inbox returns paginated fields only after authentication', async (t) => {
  let pagination;
  const form = { id: '9223372036854775807', name: 'Amira', surname: 'Friend', email: 'amira@example.com', joinReason: 'Hello', createdAt: '2026-10-22T12:00:00.000Z' };
  const { login, request } = await withServer(t, { config: adminConfig, adminRepository: {
    async listSubmissions(options) { pagination = options; return { forms: [form], total: 41 }; }
  } });
  const { cookie } = await login();
  const response = await request('/api/super/forms?page=2&pageSize=20', { headers: { Cookie: cookie } });
  assert.equal(response.status, 200);
  assert.equal(response.headers.get('cache-control'), 'no-store');
  assert.deepEqual(await response.json(), { forms: [form], total: 41, page: 2, pageSize: 20 });
  assert.deepEqual(pagination, { page: 2, pageSize: 20 });
  for (const query of ['page=0', 'pageSize=101', 'page=1&page=2', 'page=hello', 'page=1000001']) {
    assert.equal((await request(`/api/super/forms?${query}`, { headers: { Cookie: cookie } })).status, 400);
  }
});

test('session expiry and re-login invalidate old session IDs', async (t) => {
  let clock = Date.now();
  const { login, request } = await withServer(t, {
    config: adminConfig, now: () => clock, authOptions: { ttlMs: 1000 }
  });
  const first = await login();
  const second = await login(adminPassword, { Cookie: first.cookie });
  assert.notEqual(first.cookie, second.cookie);
  assert.deepEqual(await (await request('/api/super/session', { headers: { Cookie: first.cookie } })).json(), { authenticated: false });
  clock += 1001;
  assert.deepEqual(await (await request('/api/super/session', { headers: { Cookie: second.cookie } })).json(), { authenticated: false });
  assert.equal((await request('/api/super/forms', { headers: { Cookie: second.cookie } })).status, 401);
});

test('logout requires a valid session and matching CSRF token and revokes access', async (t) => {
  const { login, request } = await withServer(t, { config: adminConfig });
  const { cookie, body } = await login();
  const post = (token, extra = {}) => request('/api/super/logout', {
    method: 'POST', headers: { Cookie: cookie, ...(token ? { 'X-CSRF-Token': token } : {}), ...extra }
  });
  assert.equal((await post()).status, 403);
  assert.equal((await post('wrong')).status, 403);
  assert.equal((await post('é'.repeat(43))).status, 403);
  assert.equal((await post(body.csrfToken, { Origin: 'https://another-site.example' })).status, 403);
  const response = await post(body.csrfToken);
  assert.equal(response.status, 200);
  assert.deepEqual(await response.json(), { authenticated: false });
  assert.match(response.headers.get('set-cookie'), /Expires=Thu, 01 Jan 1970/);
  assert.equal((await request('/api/super/forms', { headers: { Cookie: cookie } })).status, 401);
  assert.equal((await post(body.csrfToken)).status, 401);
});

test('private login and reads reject cross-origin requests and malformed credentials', async (t) => {
  const { login, request } = await withServer(t, { config: adminConfig });
  assert.equal((await login(adminPassword, { Origin: 'https://another-site.example' })).response.status, 403);
  assert.equal((await login(adminPassword, { 'Sec-Fetch-Site': 'cross-site' })).response.status, 403);
  assert.equal((await login(['wrong type'])).response.status, 400);
  const { cookie } = await login();
  assert.equal((await request('/api/super/forms', { headers: { Cookie: cookie, Origin: 'https://another-site.example' } })).status, 403);
  assert.equal((await request('/api/super/login', { method: 'POST', body: new URLSearchParams({ password: adminPassword }) })).status, 415);
});

test('login attempts are rate-limited and HTTPS sessions receive Secure cookies', async (t) => {
  const limited = await withServer(t, { config: adminConfig, loginRateLimit: { max: 1, windowMs: 1000 } });
  assert.equal((await limited.login('wrong')).response.status, 401);
  const response = (await limited.login()).response;
  assert.equal(response.status, 429);
  assert.equal(response.headers.get('retry-after'), '1');
  const secure = await withServer(t, { config: { ...adminConfig, siteOrigin: 'https://drorlow.example' } });
  assert.match((await secure.login()).response.headers.get('set-cookie'), /; Secure/);
});

test('private config and read outages give safe unavailable errors', async (t) => {
  assert.equal((await (await withServer(t)).login()).response.status, 503);
  const missingReader = await withServer(t, { config: adminConfig });
  const missingSession = await missingReader.login();
  assert.equal((await missingReader.request('/api/super/forms', { headers: { Cookie: missingSession.cookie } })).status, 503);
  const broken = await withServer(t, { config: adminConfig, adminRepository: {
    async listSubmissions() { throw new Error('private host/password/query'); }
  } });
  const session = await broken.login();
  const response = await broken.request('/api/super/forms', { headers: { Cookie: session.cookie } });
  assert.equal(response.status, 503);
  assert.doesNotMatch(await response.text(), /host|password|query|stack/);
});

test('password verification uses independently salted scrypt hashes and exact input', async () => {
  const password = '  significant spaces  ';
  const first = await hashPassword(password);
  assert.notEqual(first, await hashPassword(password));
  assert.equal(await verifyPassword(password, first), true);
  assert.equal(await verifyPassword(password.trim(), first), false);
  assert.equal(await verifyPassword(password, 'invalid'), false);
  assert.equal(await verifyPassword(password, null), false);
  assert.equal(await verifyPassword(password, [first]), false);
});

test('config isolates reader credentials and rejects partial or weak settings', () => {
  const defaults = loadConfig({});
  assert.equal(defaults.database, null);
  assert.equal(defaults.adminDatabase, null);
  assert.equal(defaults.superPassword, null);
  assert.equal(defaults.host, '127.0.0.1');
  assert.equal(defaults.databaseClient, 'sqlite');
  const mysqlSettings = { DB_CLIENT: 'mysql', DB_HOST: 'localhost', DB_USER: 'writer', DB_NAME: 'DrOrlowDB' };
  assert.throws(() => loadConfig({ DB_CLIENT: 'mysql', DB_HOST: 'localhost' }), /DB_HOST|DB_USER|DB_NAME/);
  assert.throws(() => loadConfig({ PORT: '0' }), /PORT/);
  assert.throws(() => loadConfig({ TRUST_PROXY_HOPS: 'true' }), /TRUST_PROXY_HOPS/);
  assert.throws(() => loadConfig({ SITE_ORIGIN: 'https://drorlow.example/path' }), /SITE_ORIGIN/);
  assert.throws(() => loadConfig({ ...mysqlSettings, DB_SSL: 'sometimes' }), /DB_SSL/);
  assert.throws(() => loadConfig({ SUPER_ORLOW_PASSWORD: 'short' }), /SUPER_ORLOW_PASSWORD/);
  assert.throws(() => loadConfig({ ...mysqlSettings, DB_ADMIN_PASSWORD: 'read-secret' }), /DB_ADMIN_USER/);
  const configured = loadConfig({
    ...mysqlSettings, DB_PASSWORD: 'write-secret',
    DB_SSL: 'true', DB_ADMIN_USER: 'reader', DB_ADMIN_PASSWORD: 'read-secret', SUPER_ORLOW_PASSWORD: adminPassword
  });
  assert.equal(configured.databaseClient, 'mysql');
  assert.equal(configured.database.ssl.rejectUnauthorized, true);
  assert.equal(configured.database.user, 'writer');
  assert.equal(configured.adminDatabase.user, 'reader');
  assert.equal(configured.adminDatabase.password, 'read-secret');
  assert.equal(configured.adminDatabase.host, configured.database.host);
});
