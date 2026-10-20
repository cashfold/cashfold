-- 0004: how far each device has confirmed it holds, so ops can be pruned only after every active device has them (FR-082).
CREATE TABLE snapshot_ack (
  fold_id bytea NOT NULL REFERENCES fold(fold_id) ON DELETE CASCADE,
  dev_id  bytea NOT NULL,
  seq     bigint NOT NULL,
  PRIMARY KEY (fold_id, dev_id)
);
