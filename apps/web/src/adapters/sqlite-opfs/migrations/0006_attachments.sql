-- 0006: attachments (FR-093). The sealed pieces of the files attached to transactions, exactly as they travel: one AES-256-GCM frame
-- each. `sent` is 0 for pieces made here that the service does not have yet. Dropped with the Fold.
CREATE TABLE attachment_chunk (
  fold_id BLOB NOT NULL CHECK (length(fold_id)=16),
  att_id  BLOB NOT NULL CHECK (length(att_id)=16),
  idx     INTEGER NOT NULL CHECK (idx >= 0),
  data    BLOB NOT NULL,
  sent    INTEGER NOT NULL DEFAULT 0 CHECK (sent IN (0,1)),
  PRIMARY KEY (fold_id, att_id, idx)
) STRICT, WITHOUT ROWID;
CREATE INDEX attachment_chunk_unsent ON attachment_chunk(sent) WHERE sent = 0;
