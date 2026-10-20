-- 0004: what sync needs beyond the op log. `device` holds the signing keys of the account's devices (learned from the service),
-- which is how ops signed by another device are verified. `fold.snapshot_base` records that the log below the pull cursor was
-- replaced by a verified snapshot, and `last_synced_at` is when a sync last finished cleanly.
CREATE TABLE device (
  dev_id     BLOB PRIMARY KEY CHECK (length(dev_id)=16),
  sig_pk     BLOB NOT NULL CHECK (length(sig_pk)=32),
  revoked    INTEGER NOT NULL DEFAULT 0,
  label      TEXT,
  created_at INTEGER NOT NULL DEFAULT 0
) STRICT, WITHOUT ROWID;

ALTER TABLE fold ADD COLUMN snapshot_base INTEGER NOT NULL DEFAULT 0;
ALTER TABLE fold ADD COLUMN last_synced_at INTEGER;
