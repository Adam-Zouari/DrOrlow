'use strict';

const { randomBytes, timingSafeEqual, scrypt: scryptCallback } = require('node:crypto');
const { promisify } = require('node:util');
const scrypt = promisify(scryptCallback);

async function hashPassword(password) {
  const salt = randomBytes(16).toString('hex');
  const derivedKey = await scrypt(password, salt, 64);
  // The algorithm, salt, and derived key are stored; the password is discarded.
  return `scrypt$${salt}$${derivedKey.toString('hex')}`;
}

async function verifyPassword(password, encoded) {
  if (typeof password !== 'string' || typeof encoded !== 'string' || !/^scrypt\$[a-f0-9]{32}\$[a-f0-9]{128}$/.test(encoded)) return false;
  const [, salt, storedKey] = encoded.split('$');
  const derivedKey = await scrypt(password, salt, 64);
  return timingSafeEqual(derivedKey, Buffer.from(storedKey, 'hex'));
}

module.exports = { hashPassword, verifyPassword };
