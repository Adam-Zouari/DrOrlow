'use strict';

const { loadConfig } = require('./config');
const { createStorage } = require('./database');
const { resolveOwnerSecret } = require('./owner-secret');
const { createApp } = require('./app');

async function createRuntime(config = loadConfig(), { logger = console } = {}) {
  const owner = await resolveOwnerSecret(config);
  const storage = createStorage(config);
  let closing;
  const close = () => {
    if (!closing) closing = Promise.resolve().then(() => storage.close());
    return closing;
  };
  try {
    const app = createApp({
      config: { ...config, superPassword: owner.password },
      repository: storage.repository,
      adminRepository: storage.adminRepository,
      logger
    });
    return { app, close, storageClient: config.databaseClient, ownerSecretPath: owner.path, config };
  } catch (error) {
    await close();
    throw error;
  }
}

async function startServer(config = loadConfig(), { logger = console } = {}) {
  const runtime = await createRuntime(config, { logger });
  let server;
  try {
    server = runtime.app.listen(config.port, config.host);
    await new Promise((resolve, reject) => {
      const ready = () => { server.removeListener('error', failed); resolve(); };
      const failed = (error) => { server.removeListener('listening', ready); reject(error); };
      server.once('listening', ready);
      server.once('error', failed);
    });
  } catch (error) {
    await runtime.close();
    throw error;
  }

  logger.log(`Dr Orlow is running at http://${config.host}:${server.address().port}`);
  logger.log(`Form storage: ${runtime.storageClient === 'sqlite' ? 'SQLite (automatic local setup)' : 'MySQL'}.`);
  if (runtime.ownerSecretPath) logger.log(`Super Orlow secret phrase is saved in: ${runtime.ownerSecretPath}`);

  let stopping;
  const shutdown = () => {
    if (stopping) return stopping;
    stopping = (async () => {
      const timeout = setTimeout(() => process.exit(1), 10000);
      timeout.unref();
      try {
        await new Promise((resolve) => server.close(resolve));
        await runtime.close();
      } finally {
        clearTimeout(timeout);
        process.removeListener('SIGINT', onSignal);
        process.removeListener('SIGTERM', onSignal);
      }
    })();
    return stopping;
  };
  const onSignal = () => shutdown().catch(() => { process.exitCode = 1; });
  process.once('SIGINT', onSignal);
  process.once('SIGTERM', onSignal);
  server.on('error', (error) => {
    logger.error('Server failed:', error.code || error.name);
    process.exitCode = 1;
    onSignal();
  });
  return { server, runtime, shutdown };
}

module.exports = { createRuntime, startServer };
