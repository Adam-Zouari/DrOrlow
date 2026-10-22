'use strict';

const fs = require('node:fs');
const path = require('node:path');
const { isWithin, resolveSqlitePath } = require('./config');

// Resolve existing ancestors as well as the final file to detect directory links.
// loadConfig stays pure; filesystem checks happen only when opening storage.
function realDestination(destination) {
  let existing = destination;
  const missing = [];
  while (!fs.existsSync(existing)) {
    const parent = path.dirname(existing);
    if (parent === existing) throw new Error('The SQLite storage path could not be resolved.');
    missing.unshift(path.basename(existing));
    existing = parent;
  }
  return path.join(fs.realpathSync(existing), ...missing);
}

function assertPrivateDestination(sqlitePath) {
  const publicPath = fs.realpathSync(path.resolve(__dirname, '../public'));
  if (isWithin(publicPath, realDestination(sqlitePath))) {
    throw new Error('SQLITE_PATH must not resolve inside the public directory.');
  }
}

function protectFile(filePath) {
  if (fs.existsSync(filePath)) fs.chmodSync(filePath, 0o600);
}

function createSqliteStorage(configuredPath) {
  const sqlitePath = resolveSqlitePath(configuredPath);
  assertPrivateDestination(sqlitePath);
  const directory = path.dirname(sqlitePath);
  fs.mkdirSync(directory, { recursive: true, mode: 0o700 });
  assertPrivateDestination(sqlitePath);
  // Create the database with private POSIX permissions before SQLite opens it.
  // On Windows these mode bits do not replace the owner's existing NTFS ACLs.
  const descriptor = fs.openSync(sqlitePath, 'a', 0o600);
  fs.closeSync(descriptor);
  protectFile(sqlitePath);

  const { DatabaseSync } = require('node:sqlite');
  const writer = new DatabaseSync(sqlitePath);
  let reader;
  let writerClosed = false;
  let readerClosed = false;
  const closeWriter = async () => {
    if (!writerClosed) {
      writer.close();
      writerClosed = true;
    }
  };
  const closeReader = async () => {
    if (reader && !readerClosed) {
      reader.close();
      readerClosed = true;
    }
  };
  try {
    // DatabaseSync in Node 22.14 has no constructor timeout option.
    writer.exec('PRAGMA busy_timeout = 5000; PRAGMA journal_mode = WAL; PRAGMA synchronous = FULL; PRAGMA foreign_keys = ON; PRAGMA trusted_schema = OFF;');
    writer.exec(fs.readFileSync(path.join(__dirname, 'sqlite-schema.sql'), 'utf8'));
    for (const filename of [sqlitePath, `${sqlitePath}-wal`, `${sqlitePath}-shm`]) protectFile(filename);
    reader = new DatabaseSync(sqlitePath, { readOnly: true });
    reader.exec('PRAGMA busy_timeout = 5000; PRAGMA query_only = ON; PRAGMA trusted_schema = OFF;');

    const insert = writer.prepare(`INSERT INTO form_submissions
      (name, surname, gender, email, pemail, birthday, details, interests,
       join_reason, rating, sports, science, arts)
      VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`);
    insert.setReadBigInts(true);
    const count = reader.prepare('SELECT COUNT(*) AS total FROM form_submissions');
    const list = reader.prepare(`SELECT CAST(id AS TEXT) AS id, name, surname,
      gender, email, pemail, birthday, details, interests, join_reason AS joinReason,
      rating, sports, science, arts, created_at AS createdAt
      FROM form_submissions ORDER BY id DESC LIMIT ? OFFSET ?`);

    return {
      repository: {
        async createSubmission(form) {
          insert.run(form.name, form.surname, form.gender, form.email,
            form.pemail, form.birthday, form.details, form.interests,
            form.joinReason, form.rating, Number(form.sports), Number(form.science), Number(form.arts));
        },
        close: closeWriter
      },
      adminRepository: {
        async listSubmissions({ page, pageSize }) {
          const { total } = count.get();
          const forms = list.all(pageSize, (page - 1) * pageSize).map((row) => ({
            ...row, sports: Boolean(row.sports), science: Boolean(row.science), arts: Boolean(row.arts)
          }));
          return { forms, total };
        },
        close: closeReader
      },
      async close() {
        try {
          await closeReader();
        } finally {
          await closeWriter();
        }
      }
    };
  } catch (error) {
    if (reader) reader.close();
    writer.close();
    throw error;
  }
}

module.exports = { createSqliteStorage };
