import { createMemoryStore } from './store/memory-store.js';
import { describeRelay } from '../test/support/relay-suite.js';

describeRelay('memory store', async () => createMemoryStore());
