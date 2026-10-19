-- 0005: sharing. The membership log of each Fold, kept as the signed entries the members wrote (ARCH 7.3, 8.2). It has no foreign key
-- to `fold`: an invitation is read, and its log verified, before the Fold is joined; leaving or being removed clears it with the Fold.
CREATE TABLE fold_log (
  fold_id BLOB NOT NULL CHECK (length(fold_id)=16),
  idx     INTEGER NOT NULL CHECK (idx >= 0),
  entry   BLOB NOT NULL,
  PRIMARY KEY (fold_id, idx)
) STRICT, WITHOUT ROWID;
