-- 0001: sync plumbing. Everything the sync engine needs; derived from ARCHITECTURE.md 8.2.
CREATE TABLE fold (
  fold_id        BLOB PRIMARY KEY CHECK (length(fold_id)=16),
  name           TEXT NOT NULL,
  epoch          INTEGER NOT NULL CHECK (epoch >= 1),
  role           INTEGER NOT NULL CHECK (role IN (1,2,3)),         -- 1 owner, 2 editor, 3 viewer
  base_currency  TEXT NOT NULL,
  pull_cursor    INTEGER NOT NULL DEFAULT 0,                       -- last server_seq applied
  created_at     INTEGER NOT NULL
) STRICT;

CREATE TABLE fold_key (                                            -- opened FKs, wrapped by the app key
  fold_id BLOB NOT NULL REFERENCES fold(fold_id) ON DELETE CASCADE,
  epoch   INTEGER NOT NULL,
  fk_wrapped BLOB NOT NULL,                                        -- AES-256-GCM(DBK-derived, FK) so FK never sits plain in pages at rest
  PRIMARY KEY (fold_id, epoch)
) STRICT;

CREATE TABLE op_log (                                              -- every op ever seen, local or remote
  fold_id   BLOB NOT NULL REFERENCES fold(fold_id) ON DELETE CASCADE,
  op_id     BLOB NOT NULL,
  rec_id    BLOB NOT NULL,
  dev_id    BLOB NOT NULL,
  dev_seq   INTEGER NOT NULL,
  hlc_wall  INTEGER NOT NULL, hlc_ctr INTEGER NOT NULL,
  epoch     INTEGER NOT NULL,
  schema_ver INTEGER NOT NULL,
  blob      BLOB NOT NULL,                                         -- nonce||ct||tag, exactly what the server stores
  sig       BLOB NOT NULL CHECK (length(sig)=64),
  server_seq INTEGER,                                              -- NULL until acknowledged by server
  state     INTEGER NOT NULL DEFAULT 0,                            -- 0 pending-push, 1 acked, 2 applied-remote
  PRIMARY KEY (fold_id, op_id)
) STRICT;
CREATE INDEX op_log_push ON op_log(fold_id, state) WHERE state = 0;
CREATE UNIQUE INDEX op_log_dev ON op_log(fold_id, dev_id, dev_seq);
CREATE INDEX op_log_hlc ON op_log(fold_id, hlc_wall DESC, hlc_ctr DESC);   -- the newest stamp seeds the clock

-- Ops that failed verification or validation are kept (not applied) so the user can see them in Needs attention.
CREATE TABLE sync_quarantine (
  fold_id BLOB NOT NULL REFERENCES fold(fold_id) ON DELETE CASCADE,
  op_id BLOB NOT NULL, rec_id BLOB NOT NULL, dev_id BLOB NOT NULL, dev_seq INTEGER NOT NULL,
  hlc_wall INTEGER NOT NULL, hlc_ctr INTEGER NOT NULL, epoch INTEGER NOT NULL, schema_ver INTEGER NOT NULL,
  blob BLOB NOT NULL, sig BLOB NOT NULL,
  reason TEXT NOT NULL, seen_at INTEGER NOT NULL,
  PRIMARY KEY (fold_id, op_id)
) STRICT;

-- Merge state, generic for every table. A record's fields (with the clock that won), its set tags and its table code
-- are persisted here exactly as the in-memory RecordState, so merge never depends on the domain tables.
-- Deviation from ARCH 8.2: field_clock also stores op_id (total order on ties) and the value as deterministic CBOR.
CREATE TABLE record_meta (
  fold_id BLOB NOT NULL REFERENCES fold(fold_id) ON DELETE CASCADE,
  rec_id BLOB NOT NULL, table_code INTEGER NOT NULL CHECK (table_code BETWEEN 1 AND 14),
  table_conflict INTEGER NOT NULL DEFAULT 0,
  PRIMARY KEY (fold_id, rec_id)
) STRICT, WITHOUT ROWID;

CREATE TABLE field_clock (
  fold_id BLOB NOT NULL REFERENCES fold(fold_id) ON DELETE CASCADE,
  rec_id BLOB NOT NULL, field_id INTEGER NOT NULL,
  hlc_wall INTEGER NOT NULL, hlc_ctr INTEGER NOT NULL, dev_id BLOB NOT NULL, op_id BLOB NOT NULL,
  value BLOB NOT NULL,
  PRIMARY KEY (fold_id, rec_id, field_id)
) STRICT, WITHOUT ROWID;

-- Add-wins observed-remove sets: a member is present while it has an add tag that no remove has observed.
CREATE TABLE set_add (
  fold_id BLOB NOT NULL REFERENCES fold(fold_id) ON DELETE CASCADE,
  rec_id BLOB NOT NULL, field_id INTEGER NOT NULL, member BLOB NOT NULL, tag BLOB NOT NULL,
  PRIMARY KEY (fold_id, rec_id, field_id, member, tag)
) STRICT, WITHOUT ROWID;
CREATE TABLE set_removed (
  fold_id BLOB NOT NULL REFERENCES fold(fold_id) ON DELETE CASCADE,
  rec_id BLOB NOT NULL, field_id INTEGER NOT NULL, member BLOB NOT NULL, tag BLOB NOT NULL,
  PRIMARY KEY (fold_id, rec_id, field_id, member, tag)
) STRICT, WITHOUT ROWID;
