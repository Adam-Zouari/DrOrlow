'use strict';

const assert = require('node:assert/strict');
const test = require('node:test');
const fs = require('node:fs/promises');
const path = require('node:path');
const os = require('node:os');
const { resolveOwnerSecret } = require('../../server/owner-secret');

async function temporaryDirectory(t) {
  const directory = await fs.mkdtemp(path.join(os.tmpdir(), 'drorlow-secret-'));
  t.after(async () => {
    assert.equal(path.dirname(directory), path.resolve(os.tmpdir()));
    assert.ok(path.basename(directory).startsWith('drorlow-secret-'));
    await fs.rm(directory, { recursive: true, force: true });
  });
  return directory;
}

test('concurrent first starts reuse one complete secret and leave no temporary secret files', async (t) => {
  const dataDirectory = await temporaryDirectory(t);
  const [first, second] = await Promise.all([
    resolveOwnerSecret({ dataDirectory }), resolveOwnerSecret({ dataDirectory })
  ]);
  assert.equal(first.password, second.password);
  assert.match(first.password, /^Orlow-[A-Za-z0-9_-]{43}$/);
  assert.equal((await fs.readFile(first.path, 'utf8')).trim(), first.password);
  assert.deepEqual(await fs.readdir(dataDirectory), ['super-orlow.secret']);
  const later = await resolveOwnerSecret({ dataDirectory });
  assert.equal(later.password, first.password);
});

test('an explicitly configured secret takes precedence without creating or copying a secret file', async (t) => {
  const dataDirectory = await temporaryDirectory(t);
  const superPassword = '  an explicitly chosen long phrase  ';
  const result = await resolveOwnerSecret({ dataDirectory, superPassword });
  assert.equal(result.password, superPassword);
  assert.equal(result.path, null);
  assert.deepEqual(await fs.readdir(dataDirectory), []);
});

test('an invalid retained secret stops setup without replacing it', async (t) => {
  const dataDirectory = await temporaryDirectory(t);
  const filename = path.join(dataDirectory, 'super-orlow.secret');
  await fs.writeFile(filename, '');
  await assert.rejects(resolveOwnerSecret({ dataDirectory }), /secret is invalid/);
  assert.equal(await fs.readFile(filename, 'utf8'), '');
});

test('a restored secret is reused unchanged and kept private where POSIX permissions apply', async (t) => {
  const dataDirectory = await temporaryDirectory(t);
  const filename = path.join(dataDirectory, 'super-orlow.secret');
  const contents = '  An existing private owner phrase  \r\n';
  await fs.writeFile(filename, contents, { mode: 0o644 });
  const restored = await resolveOwnerSecret({ dataDirectory });
  assert.equal(restored.password, contents.replace(/\r\n$/, ''));
  assert.equal(await fs.readFile(filename, 'utf8'), contents);
  if (process.platform !== 'win32') {
    assert.equal((await fs.stat(filename)).mode & 0o777, 0o600);
    await fs.chmod(filename, 0o400);
    assert.equal((await resolveOwnerSecret({ dataDirectory })).password, restored.password);
    assert.equal((await fs.stat(filename)).mode & 0o777, 0o400);
  }
});

test('an oversized or non-file retained secret fails without replacing data', async (t) => {
  const dataDirectory = await temporaryDirectory(t);
  const oversized = path.join(dataDirectory, 'large.secret');
  const contents = 'a'.repeat(1027);
  await fs.writeFile(oversized, contents);
  await assert.rejects(resolveOwnerSecret({ ownerSecretPath: oversized }), /secret is invalid/);
  assert.equal(await fs.readFile(oversized, 'utf8'), contents);
  const directory = path.join(dataDirectory, 'directory.secret');
  await fs.mkdir(directory);
  await assert.rejects(resolveOwnerSecret({ ownerSecretPath: directory }), /regular private file/);
});

test('a secret cannot be stored in the public website directory', async () => {
  await assert.rejects(resolveOwnerSecret({
    ownerSecretPath: path.resolve(__dirname, '../../public/forbidden.secret')
  }), /outside public/);
});
