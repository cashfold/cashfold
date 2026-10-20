import { foldRef, type AttachmentTransportPort, type RelayLink } from '@cashfold/core';

// The pieces of attachments over a signed-in session: PUT writes one (once), GET reads one back. The service stores them as they are.

const path = (fold: Parameters<typeof foldRef>[0], attachment: Parameters<typeof foldRef>[0], index: number) => `/folds/${foldRef(fold)}/attachments/${foldRef(attachment)}/chunks/${index}`;

export function createWebAttachmentTransport(link: () => RelayLink | undefined): AttachmentTransportPort {
  return {
    async put(fold, attachment, index, bytes) {
      const l = link();
      if (l === undefined) return 'offline';
      const r = await l.request('PUT', path(fold, attachment, index), bytes);
      if (r.ok) return 'ok';
      if (r.kind === 'offline') return 'offline';
      return r.status === 413 ? 'quota' : 'failed';
    },
    async get(fold, attachment, index) {
      const l = link();
      if (l === undefined) return 'offline';
      const r = await l.request('GET', path(fold, attachment, index));
      if (r.ok) return r.body instanceof Uint8Array ? r.body : 'failed';
      if (r.kind === 'offline') return 'offline';
      return r.kind === 'not_found' ? 'missing' : 'failed';
    },
  };
}
