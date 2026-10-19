-- 0002: Folds, membership and the op log. `blob`, `sig` and `snapshot.blob` are ciphertext the server cannot open.
CREATE TABLE fold (
  fold_id    bytea PRIMARY KEY CHECK (length(fold_id) = 16),
  created_at bigint NOT NULL,
  head_seq   bigint NOT NULL DEFAULT 0
);

CREATE TABLE fold_member (
  fold_id    bytea NOT NULL REFERENCES fold(fold_id) ON DELETE CASCADE,
  member     text NOT NULL REFERENCES account(account_id) ON DELETE CASCADE,
  role       smallint NOT NULL CHECK (role IN (1, 2, 3)),                 -- 1 owner, 2 editor, 3 viewer
  from_epoch integer NOT NULL DEFAULT 1,
  removed_at bigint,
  PRIMARY KEY (fold_id, member)
);

CREATE TABLE op (
  fold_id    bytea NOT NULL REFERENCES fold(fold_id) ON DELETE CASCADE,
  server_seq bigint NOT NULL,
  op_id      bytea NOT NULL CHECK (length(op_id) = 16),
  rec_id     bytea NOT NULL CHECK (length(rec_id) = 16),
  dev_id     bytea NOT NULL CHECK (length(dev_id) = 16),
  dev_seq    bigint NOT NULL,
  hlc_wall   bigint NOT NULL,
  hlc_ctr    integer NOT NULL,
  epoch      integer NOT NULL,
  schema_ver integer NOT NULL,
  blob       bytea NOT NULL,
  sig        bytea NOT NULL CHECK (length(sig) = 64),
  PRIMARY KEY (fold_id, server_seq),
  UNIQUE (fold_id, op_id)
);

-- Highest device sequence ever stored per Fold, so the gapless check survives pruning of old ops.
CREATE TABLE device_seq (
  fold_id  bytea NOT NULL REFERENCES fold(fold_id) ON DELETE CASCADE,
  dev_id   bytea NOT NULL,
  last_seq bigint NOT NULL,
  PRIMARY KEY (fold_id, dev_id)
);

CREATE TABLE snapshot (
  fold_id bytea PRIMARY KEY REFERENCES fold(fold_id) ON DELETE CASCADE,
  at_seq  bigint NOT NULL,
  blob    bytea NOT NULL,
  sig     bytea NOT NULL CHECK (length(sig) = 64)
);
