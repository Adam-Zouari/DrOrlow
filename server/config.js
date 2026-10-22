'use strict';

const path = require('node:path');

const workspaceRoot = path.resolve(__dirname, '..');
const publicDirectory = path.join(workspaceRoot, 'public');

function isWithin(directory, target) {
  const relative = path.relative(directory, target);
  return relative === '' || (!relative.startsWith(`..${path.sep}`) && relative !== '..' && !path.isAbsolute(relative));
}

function resolveSqlitePath(value) {
  if (value === ':memory:' || (value && value.includes('\0'))) {
    throw new Error('SQLITE_PATH must name a persistent database file.');
  }
  const sqlitePath = path.resolve(workspaceRoot, value || 'data/drorlow.sqlite');
  if (isWithin(publicDirectory, sqlitePath)) {
    throw new Error('SQLITE_PATH must be outside the public directory.');
  }
  return sqlitePath;
}

function integer(value, fallback, min, max, label) {
  if (value === undefined || value === '') return fallback;
  if (!/^\d+$/.test(value) || Number(value) < min || Number(value) > max) {
    throw new Error(`${label} must be an integer between ${min} and ${max}.`);
  }
  return Number(value);
}

function loadConfig(env = process.env) {
  const requiredDatabaseValues = ['DB_HOST', 'DB_USER', 'DB_NAME'];
  const configuredCount = requiredDatabaseValues.filter((key) => Boolean(env[key])).length;
  if (env.DB_CLIENT && !['sqlite', 'mysql'].includes(env.DB_CLIENT)) {
    throw new Error('DB_CLIENT must be sqlite or mysql.');
  }
  const databaseClient = env.DB_CLIENT || 'sqlite';
  if (databaseClient === 'mysql' && configuredCount !== requiredDatabaseValues.length) {
    throw new Error('DB_CLIENT=mysql requires DB_HOST, DB_USER, and DB_NAME.');
  }
  const sqlitePath = resolveSqlitePath(databaseClient === 'sqlite' ? env.SQLITE_PATH : undefined);
  let siteOrigin;
  if (env.SITE_ORIGIN) {
    const origin = new URL(env.SITE_ORIGIN);
    if (!['http:', 'https:'].includes(origin.protocol) || origin.origin !== env.SITE_ORIGIN) {
      throw new Error('SITE_ORIGIN must be an http(s) origin without a path or trailing slash.');
    }
    siteOrigin = origin.origin;
  }
  if (databaseClient === 'mysql' && env.DB_SSL && !['true', 'false'].includes(env.DB_SSL)) {
    throw new Error('DB_SSL must be true or false.');
  }
  const database = databaseClient === 'mysql' ? {
    host: env.DB_HOST,
    port: integer(env.DB_PORT, 3306, 1, 65535, 'DB_PORT'),
    user: env.DB_USER,
    password: env.DB_PASSWORD || '',
    database: env.DB_NAME,
    ...(env.DB_SSL === 'true' ? { ssl: { rejectUnauthorized: true } } : {})
  } : null;
  if (env.SUPER_ORLOW_PASSWORD && (env.SUPER_ORLOW_PASSWORD.length < 20 || env.SUPER_ORLOW_PASSWORD.length > 256)) {
    throw new Error('SUPER_ORLOW_PASSWORD must contain between 20 and 256 characters.');
  }
  if (databaseClient === 'mysql' && (env.DB_ADMIN_USER || env.DB_ADMIN_PASSWORD) && (!database || !env.DB_ADMIN_USER)) {
    throw new Error('DB_ADMIN_USER requires the form database configuration.');
  }
  return {
    host: env.HOST || '127.0.0.1',
    port: integer(env.PORT, 3000, 1, 65535, 'PORT'),
    trustProxyHops: integer(env.TRUST_PROXY_HOPS, 0, 0, 5, 'TRUST_PROXY_HOPS'),
    siteOrigin,
    databaseClient,
    database,
    sqlitePath,
    dataDirectory: path.dirname(sqlitePath),
    superPassword: env.SUPER_ORLOW_PASSWORD || null,
    adminDatabase: database && env.DB_ADMIN_USER ? { ...database, user: env.DB_ADMIN_USER, password: env.DB_ADMIN_PASSWORD || '' } : null
  };
}

module.exports = { loadConfig, resolveSqlitePath, isWithin };
