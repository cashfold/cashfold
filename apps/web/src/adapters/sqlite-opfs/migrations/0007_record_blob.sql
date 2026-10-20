-- 0007: a whole record's merge state in one row (SC-008). A Fold is read back in one row per record instead of one per field, which is the
-- difference between seconds and a fraction of a second at fifty thousand transactions. A copy of what record_meta, field_clock, set_add and
-- set_removed hold, written in the same transaction; they stay the source of truth, and a missing copy is rebuilt from them.
CREATE TABLE record_blob (
  fold_id BLOB NOT NULL CHECK (length(fold_id)=16),
  rec_id  BLOB NOT NULL CHECK (length(rec_id)=16),
  state   BLOB NOT NULL,
  PRIMARY KEY (fold_id, rec_id)
) STRICT, WITHOUT ROWID;
