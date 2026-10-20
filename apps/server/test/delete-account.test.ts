import { createMemoryStore } from '../src/store/memory-store.js';
import { describeDeleteAccount } from './support/delete-account-suite.js';

// Account deletion on the memory store (FR-101). The PostgreSQL run is test/sharing.int.test.ts.
describeDeleteAccount('memory store', async () => createMemoryStore());
