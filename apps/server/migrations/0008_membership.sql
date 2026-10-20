-- 0008: sharing. The membership log of each Fold (signed, hash-chained entries kept exactly as the clients wrote them, ARCH 7.3)
-- and the signature an account made over its own public key bundle, which is handed to people who invite it (FR-106).
CREATE TABLE fold_log (
  fold_id bytea NOT NULL REFERENCES fold(fold_id) ON DELETE CASCADE,
  idx     integer NOT NULL CHECK (idx >= 0),
  entry   bytea NOT NULL,
  hash    bytea NOT NULL CHECK (length(hash) = 32),
  PRIMARY KEY (fold_id, idx)
);

ALTER TABLE account ADD COLUMN bundle_sig bytea CHECK (bundle_sig IS NULL OR length(bundle_sig) = 64);
