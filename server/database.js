'use strict';

function createPool(config) {
  const mysql = require('mysql2/promise');
  const pool = mysql.createPool({
    ...config,
    connectionLimit: 5,
    waitForConnections: true,
    queueLimit: 20,
    connectTimeout: 5000,
    charset: 'utf8mb4',
    multipleStatements: false,
    dateStrings: true,
    supportBigNumbers: true,
    bigNumberStrings: true
  });
  return pool;
}

function createSubmissionRepository(config) {
  const pool = createPool(config);
  return {
    async createSubmission(form) {
      await pool.execute(`INSERT INTO form_submissions
        (name, surname, gender, email, pemail, birthday,
         details, interests, join_reason, rating, sports, science, arts)
        VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`, [
        form.name, form.surname, form.gender,
        form.email, form.pemail, form.birthday, form.details, form.interests,
        form.joinReason, form.rating, form.sports, form.science, form.arts
      ]);
    },
    close: () => pool.end()
  };
}

function createSubmissionReader(config) {
  const pool = createPool(config);
  return {
    async listSubmissions({ page, pageSize }) {
      const [[{ total }]] = await pool.execute('SELECT COUNT(*) AS total FROM form_submissions');
      const [rows] = await pool.execute(`SELECT id, name, surname, gender, email, pemail, birthday,
        details, interests, join_reason AS joinReason, rating, sports, science, arts,
        UNIX_TIMESTAMP(created_at) AS createdAt FROM form_submissions
        ORDER BY id DESC LIMIT ? OFFSET ?`, [pageSize, (page - 1) * pageSize]);
      return {
        total: Number(total),
        forms: rows.map((row) => ({
          ...row, id: String(row.id), sports: Boolean(Number(row.sports)),
          science: Boolean(Number(row.science)), arts: Boolean(Number(row.arts)),
          createdAt: new Date(Number(row.createdAt) * 1000).toISOString()
        }))
      };
    },
    close: () => pool.end()
  };
}

function createStorage(config) {
  if (config.databaseClient === 'sqlite') {
    const { createSqliteStorage } = require('./sqlite');
    return createSqliteStorage(config.sqlitePath);
  }
  if (config.databaseClient !== 'mysql' || !config.database) {
    throw new Error('Choose a configured mysql or sqlite database client.');
  }
  const repository = createSubmissionRepository(config.database);
  let adminRepository;
  try {
    adminRepository = config.adminDatabase ? createSubmissionReader(config.adminDatabase) : null;
  } catch (error) {
    repository.close().catch(() => {});
    throw error;
  }
  let closing;
  return {
    repository,
    adminRepository,
    close() {
      if (!closing) {
        closing = Promise.all([repository, adminRepository].filter(Boolean).map((source) => source.close()));
      }
      return closing;
    }
  };
}

module.exports = { createSubmissionRepository, createSubmissionReader, createStorage };
