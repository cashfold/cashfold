import { createMemoryStore } from '../src/store/memory-store.js';
import { describeAttachments } from './support/attachments-suite.js';

// Attachment pieces on the memory store (FR-093). The PostgreSQL run is test/sharing.int.test.ts.
describeAttachments('memory store', async () => createMemoryStore());
