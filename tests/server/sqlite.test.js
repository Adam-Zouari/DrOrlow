'use strict';

const assert = require('node:assert/strict');
const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');
const test = require('node:test');
const { DatabaseSync } = require('node:sqlite');
const { loadConfig } = require('../../server/config');
const { createStorage } = require('../../server/database');

const sample = {
  name: 'Amira', surname: 'Friend', gender: 'Prefer not to say',
  email: 'amira@example.com', pemail: null, birthday: '2000-02-29',
  details: 'Hello, friend. 🐙', interests: 'Music and science', joinReason: 'I would like to help.',
  rating: 'cute', sports: true, science: false, arts: true
};

function fixture(t) {
  const directory = fs.mkdtempSync(path.join(os.tmpdir(), 'drorlow-sqlite-'));
  const sqlitePath = path.join(directory, 'private-data', 'drorlow.sqlite');
  const storages = [];
  t.after(async () => {
    for (const storage of storages) await storage.close();
    // Cleanup is limited to this test's explicitly created temporary directory.
    assert.equal(path.dirname(path.resolve(directory)), path.resolve(os.tmpdir()));
    assert.ok(path.basename(directory).startsWith('drorlow-sqlite-'));
    fs.rmSync(directory, { recursive: true, force: true });
  });
  return {
    directory, sqlitePath,
    create() {
      const storage = createStorage(loadConfig({ SQLITE_PATH: sqlitePath }));
      storages.push(storage);
      return storage;
    }
  };
}

test('configuration selects SQLite by default without touching the filesystem', (t) => {
  const { sqlitePath } = fixture(t);
  const config = loadConfig({ SQLITE_PATH: sqlitePath });
  assert.equal(config.databaseClient, 'sqlite');
  assert.equal(config.database, null);
  assert.equal(config.adminDatabase, null);
  assert.equal(config.sqlitePath, sqlitePath);
  assert.equal(config.dataDirectory, path.dirname(sqlitePath));
  assert.equal(fs.existsSync(config.dataDirectory), false);
  assert.equal(loadConfig({}).sqlitePath, path.resolve(__dirname, '../../data/drorlow.sqlite'));
  assert.throws(() => loadConfig({ SQLITE_PATH: 'public/drorlow.sqlite' }), /public directory/);
  assert.throws(() => loadConfig({ SQLITE_PATH: ':memory:' }), /persistent database/);
});

test('SQLite remains the default with complete, partial, or stale MySQL settings', () => {
  const mysqlSettings = { DB_HOST: 'localhost', DB_USER: 'writer', DB_NAME: 'DrOrlowDB', DB_ADMIN_USER: 'reader', DB_ADMIN_PASSWORD: 'read-secret' };
  for (const settings of [
    mysqlSettings,
    { DB_HOST: 'stale' },
    { DB_PORT: 'ignored', DB_SSL: 'ignored', DB_ADMIN_PASSWORD: 'unused' },
    { ...mysqlSettings, DB_CLIENT: 'sqlite', DB_PORT: 'ignored', DB_SSL: 'ignored' }
  ]) {
    const sqlite = loadConfig(settings);
    assert.equal(sqlite.databaseClient, 'sqlite');
    assert.equal(sqlite.database, null);
    assert.equal(sqlite.adminDatabase, null);
  }
});

test('MySQL requires an explicit client choice and complete connection settings', () => {
  const settings = { DB_CLIENT: 'mysql', DB_HOST: 'localhost', DB_USER: 'writer', DB_NAME: 'DrOrlowDB', DB_ADMIN_USER: 'reader', DB_ADMIN_PASSWORD: 'read-secret' };
  const mysql = loadConfig(settings);
  assert.equal(mysql.databaseClient, 'mysql');
  assert.equal(mysql.database.user, 'writer');
  assert.equal(mysql.adminDatabase.user, 'reader');
  for (const field of ['DB_HOST', 'DB_USER', 'DB_NAME']) {
    const partial = { ...settings };
    delete partial[field];
    assert.throws(() => loadConfig(partial), /DB_HOST|DB_USER|DB_NAME/, field);
  }
  assert.throws(() => loadConfig({ DB_CLIENT: 'mysql' }), /requires DB_HOST/);
  assert.throws(() => loadConfig({ DB_CLIENT: 'unknown' }), /DB_CLIENT must be/);
});

test('SQLite creates private disk storage and retains every field after close and reopen', async (t) => {
  const local = fixture(t);
  const first = local.create();
  await first.repository.createSubmission(sample);
  assert.equal(fs.existsSync(local.sqlitePath), true);
  const saved = await first.adminRepository.listSubmissions({ page: 1, pageSize: 20 });
  assert.equal(saved.total, 1);
  const [form] = saved.forms;
  assert.equal(form.id, '1');
  assert.match(form.createdAt, /^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}:\d{2}\.\d{3}Z$/);
  assert.deepEqual(form, { ...sample, id: '1', createdAt: form.createdAt });
  await first.close();
  await first.close();
  const second = local.create();
  assert.deepEqual(await second.adminRepository.listSubmissions({ page: 1, pageSize: 20 }), saved);
  await second.repository.createSubmission({ ...sample, name: 'Another friend', birthday: null });
  const page = await second.adminRepository.listSubmissions({ page: 1, pageSize: 20 });
  assert.equal(page.total, 2);
  assert.equal(page.forms[0].id, '2');
  assert.equal(page.forms[0].birthday, null);
  if (process.platform !== 'win32') {
    assert.equal(fs.statSync(local.sqlitePath).mode & 0o777, 0o600);
    assert.equal(fs.statSync(path.dirname(local.sqlitePath)).mode & 0o777, 0o700);
  }
});

test('SQLite pagination orders newest submissions first and keeps SQL-looking input as text', async (t) => {
  const local = fixture(t);
  const storage = local.create();
  const details = "'); DROP TABLE form_submissions; --";
  for (const name of ['First', 'Second', 'Third']) {
    await storage.repository.createSubmission({ ...sample, name, details });
  }
  const first = await storage.adminRepository.listSubmissions({ page: 1, pageSize: 2 });
  assert.equal(first.total, 3);
  assert.deepEqual(first.forms.map((form) => form.name), ['Third', 'Second']);
  assert.equal(first.forms[0].details, details);
  const second = await storage.adminRepository.listSubmissions({ page: 2, pageSize: 2 });
  assert.equal(second.total, 3);
  assert.deepEqual(second.forms.map((form) => form.name), ['First']);
  assert.deepEqual((await storage.adminRepository.listSubmissions({ page: 3, pageSize: 2 })).forms, []);
});

test('existing unrelated tables survive initialization and BIGINT identifiers remain exact', async (t) => {
  const local = fixture(t);
  let storage = local.create();
  await storage.repository.createSubmission(sample);
  await storage.close();
  const database = new DatabaseSync(local.sqlitePath);
  try {
    database.exec("CREATE TABLE users (name TEXT NOT NULL); INSERT INTO users VALUES ('Existing friend');");
    database.prepare("UPDATE sqlite_sequence SET seq = ? WHERE name = 'form_submissions'").run(9007199254740993n);
  } finally {
    database.close();
  }
  storage = local.create();
  await storage.repository.createSubmission({ ...sample, name: 'Large identifier' });
  assert.equal((await storage.adminRepository.listSubmissions({ page: 1, pageSize: 1 })).forms[0].id, '9007199254740994');
  await storage.close();
  const reader = new DatabaseSync(local.sqlitePath, { readOnly: true });
  try {
    assert.equal(reader.prepare('SELECT name FROM users').get().name, 'Existing friend');
    assert.equal(reader.prepare('PRAGMA journal_mode').get().journal_mode, 'wal');
  } finally {
    reader.close();
  }
});

test('SQLite refuses public directories reached through filesystem links', (t) => {
  const local = fixture(t);
  const linkedDirectory = path.join(local.directory, 'linked-public');
  try {
    fs.symlinkSync(path.resolve(__dirname, '../../public'), linkedDirectory, 'junction');
  } catch (error) {
    if (['EPERM', 'EACCES', 'ENOSYS'].includes(error.code)) {
      t.skip('This environment does not permit filesystem links.');
      return;
    }
    throw error;
  }
  const config = loadConfig({ SQLITE_PATH: path.join(linkedDirectory, 'must-not-be-created.sqlite') });
  assert.throws(() => createStorage(config), /public directory/);
  assert.equal(fs.existsSync(config.sqlitePath), false);
});

test('an invalid existing database fails visibly without resetting or overwriting it', (t) => {
  const local = fixture(t);
  fs.mkdirSync(path.dirname(local.sqlitePath));
  const original = 'Existing data that is not a SQLite database. Do not overwrite.';
  fs.writeFileSync(local.sqlitePath, original);
  assert.throws(() => local.create(), /database|SQLite/i);
  assert.equal(fs.readFileSync(local.sqlitePath, 'utf8'), original);
});
