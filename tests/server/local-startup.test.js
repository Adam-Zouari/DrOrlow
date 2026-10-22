'use strict';

const assert = require('node:assert/strict');
const test = require('node:test');
const fs = require('node:fs/promises');
const os = require('node:os');
const path = require('node:path');
const { once } = require('node:events');
const { loadConfig } = require('../../server/config');
const { createRuntime, startServer } = require('../../server/runtime');

const letter = {
  name: '  Amira  ', surname: 'Friend', gender: 'Other',
  email: 'Amira@Example.test', pemail: 'Work@Example.test', birthday: '2000-02-29',
  details: "Bubbles say: '<hello>'!\nA second line.", interests: 'Music & painting',
  join_reason: 'I would like to meet an octopus ^-^',
  sports: 'yes', science: 'yes', r1: 'so-so-cute'
};

async function isolatedRuntime(t, environment = {}) {
  const directory = await fs.mkdtemp(path.join(os.tmpdir(), 'dr-orlow-runtime-'));
  const databasePath = path.join(directory, 'letters.sqlite');
  const ownerSecretPath = path.join(directory, 'owner-secret.txt');
  const config = {
    ...loadConfig({ SQLITE_PATH: databasePath, ...environment }),
    ownerSecretPath
  };
  const running = new Set();
  const errors = [];
  const logger = { log() {}, warn() {}, error(...args) { errors.push(args); } };
  t.after(async () => {
    for (const instance of running) await instance.close();
    const cleanupPath = path.resolve(directory);
    assert.equal(path.dirname(cleanupPath), path.resolve(os.tmpdir()));
    assert.ok(path.basename(cleanupPath).startsWith('dr-orlow-runtime-'));
    await fs.rm(cleanupPath, { recursive: true, force: true });
  });

  async function start() {
    const runtime = await createRuntime(config, { logger });
    let server;
    try {
      server = runtime.app.listen(0, '127.0.0.1');
      await once(server, 'listening');
    } catch (error) {
      await runtime.close();
      throw error;
    }
    const base = `http://127.0.0.1:${server.address().port}`;
    let closed = false;
    const instance = {
      runtime,
      request(route, options) { return fetch(base + route, options); },
      post(route, body, headers = {}) {
        return fetch(base + route, {
          method: 'POST', redirect: 'manual',
          headers: { 'Content-Type': 'application/json', Origin: base, ...headers },
          body: JSON.stringify(body)
        });
      },
      async login(password) {
        const response = await instance.post('/api/super/login', { password });
        assert.equal(response.status, 201, 'the owner phrase should unlock the real runtime');
        const body = await response.json();
        assert.equal(body.authenticated, true);
        return {
          cookie: (response.headers.get('set-cookie') || '').split(';')[0],
          csrfToken: body.csrfToken
        };
      },
      async close() {
        if (closed) return;
        closed = true;
        try {
          server.closeAllConnections();
          await new Promise((resolve, reject) => server.close((error) => error ? reject(error) : resolve()));
        } finally {
          await runtime.close();
          running.delete(instance);
        }
      }
    };
    running.add(instance);
    return instance;
  }
  return { config, databasePath, ownerSecretPath, start, errors };
}

test('fresh local startup accepts real forms and preserves the private inbox and owner phrase after restart', async (t) => {
  const fixture = await isolatedRuntime(t);
  assert.equal(fixture.config.databaseClient, 'sqlite');
  assert.equal(fixture.config.database, null, 'local startup must not require MySQL credentials');
  assert.equal(fixture.config.adminDatabase, null);
  const first = await fixture.start();
  assert.deepEqual(await (await first.request('/health')).json(), { status: 'ok', submissions: 'configured' });
  const originalSecretFile = await fs.readFile(fixture.ownerSecretPath, 'utf8');
  const password = originalSecretFile.trim();
  assert.ok(password.length >= 20 && password.length <= 256, 'startup should create a usable owner phrase');
  assert.ok((await fs.stat(fixture.databasePath)).isFile(), 'SQLite storage should exist without external setup');

  const submission = await first.post('/submit', letter);
  assert.equal(submission.status, 201);
  assert.equal((await submission.json()).redirect, '/Home.html?submitted=1');
  const denied = await first.request('/api/super/forms');
  assert.equal(denied.status, 401);
  assert.equal(denied.headers.get('cache-control'), 'no-store');
  assert.doesNotMatch(await denied.text(), /Amira|Bubbles|Example\.test/i);
  const owner = await first.login(password);
  const inboxResponse = await first.request('/api/super/forms?page=1&pageSize=20', { headers: { Cookie: owner.cookie } });
  assert.equal(inboxResponse.status, 200);
  const inbox = await inboxResponse.json();
  assert.equal(inbox.total, 1);
  assert.equal(inbox.forms.length, 1);
  const stored = inbox.forms[0];
  assert.deepEqual({ ...stored, id: undefined, createdAt: undefined }, {
    id: undefined, createdAt: undefined,
    name: 'Amira', surname: 'Friend', gender: 'Other', email: 'amira@example.test',
    pemail: 'work@example.test', birthday: '2000-02-29', details: letter.details,
    interests: letter.interests, joinReason: letter.join_reason, rating: 'so-so-cute',
    sports: true, science: true, arts: false
  });
  assert.equal(typeof stored.id, 'string');
  assert.ok(!Number.isNaN(Date.parse(stored.createdAt)), 'the saved letter should have a real creation date');
  for (const route of [
    '/data/letters.sqlite', '/letters.sqlite', '/data/owner-secret.txt', '/owner-secret.txt',
    '/server/runtime.js', '/.env'
  ]) {
    const response = await first.request(route);
    assert.equal(response.status, 404, `${route} should never expose local private files`);
    assert.ok(!(await response.text()).includes(password));
  }
  await first.close();

  const reopened = await fixture.start();
  assert.equal(await fs.readFile(fixture.ownerSecretPath, 'utf8'), originalSecretFile, 'restarting should preserve the owner phrase');
  assert.equal((await reopened.request('/api/super/forms', { headers: { Cookie: owner.cookie } })).status, 401,
    'a session from the stopped server should not survive a restart');
  const restoredOwner = await reopened.login(password);
  const restored = await (await reopened.request('/api/super/forms', { headers: { Cookie: restoredOwner.cookie } })).json();
  assert.equal(restored.total, 1);
  assert.deepEqual(restored.forms, inbox.forms, 'the inbox should read the same rows after reopening the SQLite file');

  // The native HTML form path uses the same persistent storage and needs no account.
  const nativeResponse = await reopened.request('/submit', {
    method: 'POST', body: new URLSearchParams({ ...letter, name: 'Nour', email: 'nour@example.test' }),
    redirect: 'manual'
  });
  assert.equal(nativeResponse.status, 303);
  const updated = await (await reopened.request('/api/super/forms', { headers: { Cookie: restoredOwner.cookie } })).json();
  assert.equal(updated.total, 2);
  assert.deepEqual(new Set(updated.forms.map((form) => form.name)), new Set(['Amira', 'Nour']));
  assert.deepEqual(fixture.errors, [], 'a default local startup should not log database connection errors');
});

test('an explicit owner phrase works on local storage without creating another secret file', async (t) => {
  const password = 'An explicit test owner phrase with enough length';
  const fixture = await isolatedRuntime(t, { SUPER_ORLOW_PASSWORD: password });
  const server = await fixture.start();
  assert.equal(server.runtime.storageClient, 'sqlite');
  assert.equal(server.runtime.ownerSecretPath, null);
  await assert.rejects(fs.access(fixture.ownerSecretPath), { code: 'ENOENT' });
  const rejected = await server.post('/api/super/login', { password: 'Not the configured owner phrase' });
  assert.equal(rejected.status, 401);
  const owner = await server.login(password);
  const inbox = await server.request('/api/super/forms', { headers: { Cookie: owner.cookie } });
  assert.equal(inbox.status, 200);
  assert.equal((await inbox.json()).total, 0);
  const logout = await server.request('/api/super/logout', {
    method: 'POST', headers: { Cookie: owner.cookie, 'X-CSRF-Token': owner.csrfToken }
  });
  assert.equal(logout.status, 200);
  assert.equal((await server.request('/api/super/forms', { headers: { Cookie: owner.cookie } })).status, 401);
  assert.deepEqual(fixture.errors, []);
});

test('the real server entry lifecycle shuts down repeatedly and cleans up a busy-port failure', async (t) => {
  const fixture = await isolatedRuntime(t);
  const logger = { log() {}, error() {} };
  const signalsBefore = {
    SIGINT: process.listenerCount('SIGINT'), SIGTERM: process.listenerCount('SIGTERM')
  };
  const running = await startServer({ ...fixture.config, port: 0 }, { logger });
  try {
    const port = running.server.address().port;
    const response = await fetch(`http://127.0.0.1:${port}/health`);
    assert.equal(response.status, 200);
    await assert.rejects(startServer({ ...fixture.config, port }, { logger }), { code: 'EADDRINUSE' });
    const first = running.shutdown();
    const second = running.shutdown();
    await Promise.all([first, second, running.runtime.close()]);
  } finally {
    await running.shutdown();
  }
  assert.equal(running.server.listening, false);
  assert.equal(process.listenerCount('SIGINT'), signalsBefore.SIGINT);
  assert.equal(process.listenerCount('SIGTERM'), signalsBefore.SIGTERM);
  const reopened = await createRuntime(fixture.config, { logger });
  await reopened.close();
});
