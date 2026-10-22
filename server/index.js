'use strict';

const { startServer } = require('./runtime');

startServer().catch((error) => {
  console.error('Server startup failed:', error.code || error.message);
  process.exitCode = 1;
});
