-- 0010: sealed attachment pieces (FR-093, ARCH 9.8). Each piece is one AES-256-GCM frame the relay cannot open; a piece is written once.
CREATE TABLE attachment_chunk (
  fold_id bytea NOT NULL REFERENCES fold(fold_id) ON DELETE CASCADE,
  att_id  bytea NOT NULL,
  idx     integer NOT NULL,
  data    bytea NOT NULL,
  PRIMARY KEY (fold_id, att_id, idx)
);
