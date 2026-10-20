import { createMemoryStore } from './memory-store.js';
import { describeStoreContract } from './store.contract.js';

describeStoreContract('memory', async () => createMemoryStore());
