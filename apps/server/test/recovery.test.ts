import { createMemoryStore } from '../src/store/memory-store.js';
import { describeRecovery } from './support/recovery-suite.js';

// The Recovery Key credential on the memory store. The PostgreSQL run is test/sharing.int.test.ts.
describeRecovery('memory store', async () => createMemoryStore());
