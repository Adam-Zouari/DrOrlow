'use strict';

const fs = require('node:fs/promises');
const path = require('node:path');
const { loadConfig } = require('./config');

async function setupDatabase() {
  const config = loadConfig();
  if (config.databaseClient === 'sqlite') {
    const { createStorage } = require('./database');
    const storage = createStorage(config);
    await storage.close();
    console.log('The SQLite form_submissions table is ready. Existing records were preserved.');
    return;
  }
  const { database } = config;
  const mysql = require('mysql2/promise');
  const connection = await mysql.createConnection({ ...database, multipleStatements: false });
  try {
    const schema = await fs.readFile(path.join(__dirname, 'schema.sql'), 'utf8');
    // Setup creates the submission table only. Existing users are never modified.
    await connection.query(schema);
    console.log('The form_submissions table is ready. Existing tables were preserved.');
  } finally {
    await connection.end();
  }
}

if (require.main === module) {
  setupDatabase().catch((error) => {
    console.error('Database setup failed:', error.code || error.message);
    process.exitCode = 1;
  });
}

module.exports = { setupDatabase };
