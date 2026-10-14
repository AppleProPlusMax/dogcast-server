import 'dotenv/config';
import { buildApp } from './app.js';
import { loadConfig } from './config.js';

try {
  const config = loadConfig();
  const app = await buildApp({ config });
  const shutdown = async (signal: string) => {
    app.log.info({ signal }, 'shutting down');
    await app.close();
    process.exit(0);
  };
  process.on('SIGINT', () => {
    void shutdown('SIGINT');
  });
  process.on('SIGTERM', () => {
    void shutdown('SIGTERM');
  });
  await app.listen({ host: config.HOST, port: config.PORT });
} catch (err) {
  console.error(err instanceof Error ? err.message : err);
  process.exit(1);
}
