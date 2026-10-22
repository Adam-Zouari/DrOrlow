'use strict';

const fs = require('node:fs/promises');
const path = require('node:path');
const { randomBytes } = require('node:crypto');
const { isWithin } = require('./config');

const publicDirectory = path.resolve(__dirname, '../public');

function validatePassword(password) {
  if (typeof password !== 'string' || password.length < 20 || password.length > 256 || /[\r\n\u0000]/.test(password)) {
    throw new Error('The local owner secret is invalid. Restore its file or set SUPER_ORLOW_PASSWORD.');
  }
  return password;
}

async function readSecret(filename) {
  const metadata = await fs.lstat(filename, { bigint: true });
  if (!metadata.isFile() || metadata.isSymbolicLink()) {
    throw new Error('The local owner secret must be a regular private file.');
  }
  // A 256-character phrase plus CRLF cannot exceed this UTF-8 byte bound.
  if (metadata.size > 1026n) throw new Error('The local owner secret is invalid. Restore its file or set SUPER_ORLOW_PASSWORD.');
  const handle = await fs.open(filename, 'r');
  try {
    const opened = await handle.stat({ bigint: true });
    // Windows lstat reports dev=0 while fstat reports the volume identifier.
    const changedDevice = process.platform !== 'win32' && opened.dev !== metadata.dev;
    if (!opened.isFile() || changedDevice || opened.ino !== metadata.ino) {
      throw new Error('The local owner secret must be a regular private file.');
    }
    // Restored copies can have broader permissions than freshly generated files.
    // Use the already-open handle so a renamed path cannot redirect chmod/read.
    // Already-private read-only files need no write to their mount or mode.
    if (process.platform !== 'win32' && (opened.mode & 0o077n) !== 0n) await handle.chmod(0o600);
    return validatePassword((await handle.readFile('utf8')).replace(/\r?\n$/, ''));
  } finally {
    await handle.close();
  }
}

async function resolveOwnerSecret(config) {
  if (config.superPassword) return { password: validatePassword(config.superPassword), path: null };
  const filename = path.resolve(config.ownerSecretPath || path.join(config.dataDirectory || path.resolve(__dirname, '../data'), 'super-orlow.secret'));
  if (isWithin(publicDirectory, filename)) throw new Error('The owner secret must be stored outside public/.');
  const directory = path.dirname(filename);
  await fs.mkdir(directory, { recursive: true, mode: 0o700 });
  const actualDirectory = await fs.realpath(directory);
  const actualPublic = await fs.realpath(publicDirectory);
  if (isWithin(actualPublic, actualDirectory)) throw new Error('The owner secret directory must be outside public/.');
  try {
    return { password: await readSecret(filename), path: filename };
  } catch (error) {
    if (error.code !== 'ENOENT') throw error;
  }

  const password = `Orlow-${randomBytes(32).toString('base64url')}`;
  const temporary = `${filename}.tmp-${randomBytes(12).toString('hex')}`;
  let createdTemporary = false;
  try {
    // Publish a complete file atomically without replacing an existing phrase.
    const handle = await fs.open(temporary, 'wx', 0o600);
    createdTemporary = true;
    try {
      await handle.writeFile(`${password}\n`, 'utf8');
      await handle.sync();
    } finally {
      await handle.close();
    }
    try {
      await fs.link(temporary, filename);
    } catch (error) {
      if (error.code !== 'EEXIST') throw error;
    }
    return { password: await readSecret(filename), path: filename };
  } finally {
    if (createdTemporary) await fs.unlink(temporary);
  }
}

module.exports = { resolveOwnerSecret };
