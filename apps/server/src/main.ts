import 'reflect-metadata';
import { createRelay } from './app.js';
import { loadConfig } from './config.js';
import { createMemoryStore } from './store/memory-store.js';
import { createPgStore } from './store/pg-store.js';

const config = loadConfig();
const store = config.store === 'postgres' ? await createPgStore(config.databaseUrl) : createMemoryStore();
const relay = await createRelay({ config, store });

if (config.rates.kind === 'upstream') {
  const refresh = (): void => void relay.services.rates.refresh().catch(() => undefined);
  refresh();
  setInterval(refresh, config.rates.everyHours * 3_600_000).unref();
}

await relay.app.listen(config.port, '0.0.0.0');
process.stdout.write(`cashfold relay listening on :${config.port} (store: ${config.store}, registration: ${config.registration})\n`);
for (const signal of ['SIGINT', 'SIGTERM'] as const) process.once(signal, () => void relay.close().then(() => process.exit(0)));
