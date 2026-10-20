-- 0003: records that were permanently removed 30 days after deletion (FR-052). The marker stops a late op for the
-- record from bringing it back; the op_log keeps the headers of its ops (identity, sequence) with the payload erased.
CREATE TABLE purged_record (
  fold_id BLOB NOT NULL REFERENCES fold(fold_id) ON DELETE CASCADE,
  rec_id BLOB NOT NULL,
  purged_at INTEGER NOT NULL,
  PRIMARY KEY (fold_id, rec_id)
) STRICT, WITHOUT ROWID;
