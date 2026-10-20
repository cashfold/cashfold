import { createMemoryStore } from '../src/store/memory-store.js';
import { describeSharing } from './support/sharing-suite.js';

// Lookup, invitations, membership log and per-member delivery on the memory store (FR-106, FR-107, FR-083, FR-102).
// The PostgreSQL run is test/sharing.int.test.ts.
describeSharing('memory store', async () => createMemoryStore());
