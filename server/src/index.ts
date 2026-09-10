import { buildApp } from './app.js';
import { config } from './config.js';
import { closeDb } from './db/index.js';

const app = await buildApp(true);
async function shutdown() {
  await app.close();
  closeDb();
}
process.on('SIGINT', () => void shutdown());
process.on('SIGTERM', () => void shutdown());
try {
  await app.listen({ port: config.port, host: config.host });
} catch (error) {
  app.log.error(error);
  await shutdown();
  process.exitCode = 1;
}
