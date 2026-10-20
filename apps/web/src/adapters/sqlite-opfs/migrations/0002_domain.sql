-- 0002: domain read models (plaintext inside the encrypted database) and derived views. Derived from ARCHITECTURE.md 8.2.
-- Rows here are projections of merge state; only the sync engine writes them.
CREATE TABLE account (
  fold_id BLOB NOT NULL REFERENCES fold(fold_id) ON DELETE CASCADE, id BLOB NOT NULL,
  kind INTEGER NOT NULL CHECK (kind BETWEEN 1 AND 6),
  name TEXT NOT NULL, currency TEXT NOT NULL, exponent INTEGER NOT NULL CHECK (exponent BETWEEN 0 AND 8),
  opening_balance_minor INTEGER NOT NULL DEFAULT 0, opening_date INTEGER NOT NULL,
  include_in_net_worth INTEGER NOT NULL DEFAULT 1, credit_limit_minor INTEGER,
  icon TEXT, color INTEGER NOT NULL DEFAULT 0, sort_order INTEGER NOT NULL DEFAULT 0,
  archived INTEGER NOT NULL DEFAULT 0, deleted INTEGER NOT NULL DEFAULT 0,
  PRIMARY KEY (fold_id, id)
) STRICT;
CREATE INDEX account_order ON account(fold_id, sort_order, name) WHERE deleted = 0;

CREATE TABLE account_group (fold_id BLOB NOT NULL REFERENCES fold(fold_id) ON DELETE CASCADE, id BLOB NOT NULL, name TEXT NOT NULL, icon TEXT, color INTEGER NOT NULL DEFAULT 0, sort_order INTEGER NOT NULL DEFAULT 0, deleted INTEGER NOT NULL DEFAULT 0, PRIMARY KEY(fold_id,id)) STRICT;
CREATE TABLE account_group_member (fold_id BLOB NOT NULL REFERENCES fold(fold_id) ON DELETE CASCADE, group_id BLOB NOT NULL, account_id BLOB NOT NULL, PRIMARY KEY(fold_id, group_id, account_id)) STRICT;

CREATE TABLE category (
  fold_id BLOB NOT NULL REFERENCES fold(fold_id) ON DELETE CASCADE, id BLOB NOT NULL, parent_id BLOB, direction INTEGER NOT NULL CHECK (direction IN (1,2)),
  name TEXT NOT NULL, icon TEXT, color INTEGER NOT NULL DEFAULT 0, sort_order INTEGER NOT NULL DEFAULT 0,
  archived INTEGER NOT NULL DEFAULT 0, deleted INTEGER NOT NULL DEFAULT 0,
  PRIMARY KEY (fold_id, id)
) STRICT;
CREATE INDEX category_tree ON category(fold_id, direction, sort_order, name) WHERE deleted = 0;

CREATE TABLE payee (fold_id BLOB NOT NULL REFERENCES fold(fold_id) ON DELETE CASCADE, id BLOB NOT NULL, name TEXT NOT NULL, color INTEGER NOT NULL DEFAULT 0, deleted INTEGER NOT NULL DEFAULT 0, PRIMARY KEY(fold_id,id)) STRICT;
CREATE TABLE tag   (fold_id BLOB NOT NULL REFERENCES fold(fold_id) ON DELETE CASCADE, id BLOB NOT NULL, name TEXT NOT NULL, color INTEGER NOT NULL DEFAULT 0, deleted INTEGER NOT NULL DEFAULT 0, PRIMARY KEY(fold_id,id)) STRICT;

CREATE TABLE txn (
  fold_id BLOB NOT NULL REFERENCES fold(fold_id) ON DELETE CASCADE, id BLOB NOT NULL, account_id BLOB NOT NULL,
  direction INTEGER NOT NULL CHECK (direction IN (0,1,2)),
  amount_minor INTEGER NOT NULL,
  currency TEXT NOT NULL,
  base_amount_minor INTEGER NOT NULL, base_currency TEXT NOT NULL, fx_rate_id BLOB,
  occurred_utc_ms INTEGER NOT NULL, tz_offset_min INTEGER NOT NULL, local_date INTEGER NOT NULL,   -- yyyymmdd
  category_id BLOB, payee_id BLOB, note TEXT,
  place_name TEXT, lat_e7 INTEGER, lon_e7 INTEGER, attachment_ref BLOB,
  is_refund INTEGER NOT NULL DEFAULT 0, is_pinned INTEGER NOT NULL DEFAULT 0,
  status INTEGER NOT NULL DEFAULT 1 CHECK (status IN (0,1,2)),
  origin_schedule BLOB, origin_n INTEGER, import_id BLOB,
  deleted INTEGER NOT NULL DEFAULT 0,
  PRIMARY KEY (fold_id, id),
  CHECK ((direction = 1 AND amount_minor < 0) OR (direction = 2 AND amount_minor > 0) OR direction = 0)
) STRICT;
CREATE INDEX txn_acct_date ON txn(fold_id, account_id, local_date, id) WHERE deleted = 0;
CREATE INDEX txn_cat_date  ON txn(fold_id, category_id, local_date) WHERE deleted = 0 AND category_id IS NOT NULL;

CREATE TABLE txn_tag (fold_id BLOB NOT NULL REFERENCES fold(fold_id) ON DELETE CASCADE, txn_id BLOB NOT NULL, tag_id BLOB NOT NULL, PRIMARY KEY(fold_id, txn_id, tag_id)) STRICT, WITHOUT ROWID;

CREATE TABLE transfer (
  fold_id BLOB NOT NULL REFERENCES fold(fold_id) ON DELETE CASCADE, id BLOB NOT NULL,
  from_account_id BLOB NOT NULL, to_account_id BLOB NOT NULL,
  from_amount_minor INTEGER NOT NULL CHECK (from_amount_minor > 0),
  to_amount_minor   INTEGER NOT NULL CHECK (to_amount_minor   > 0),
  occurred_utc_ms INTEGER NOT NULL, tz_offset_min INTEGER NOT NULL, local_date INTEGER NOT NULL,
  note TEXT, status INTEGER NOT NULL DEFAULT 1, fx_rate_id BLOB, deleted INTEGER NOT NULL DEFAULT 0,
  PRIMARY KEY (fold_id, id),
  CHECK (from_account_id <> to_account_id)
) STRICT;

-- Derived view, never synced: the two-legged ledger
CREATE VIEW ledger_entry AS
  SELECT fold_id, account_id, id AS ref_id, 0 AS leg, local_date, amount_minor, status
    FROM txn WHERE deleted = 0
  UNION ALL
  SELECT fold_id, from_account_id, id, 1, local_date, -from_amount_minor, status FROM transfer WHERE deleted = 0
  UNION ALL
  SELECT fold_id, to_account_id,   id, 2, local_date,  to_amount_minor,   status FROM transfer WHERE deleted = 0;

CREATE VIEW account_balance AS
  SELECT a.fold_id, a.id AS account_id,
         a.opening_balance_minor + COALESCE((SELECT SUM(e.amount_minor) FROM ledger_entry e
            WHERE e.fold_id=a.fold_id AND e.account_id=a.id AND e.status=1), 0) AS balance_minor
    FROM account a WHERE a.deleted = 0;
-- SQLite SUM() raises "integer overflow" instead of wrapping; callers must propagate it.

CREATE TABLE budget (
  fold_id BLOB NOT NULL REFERENCES fold(fold_id) ON DELETE CASCADE, id BLOB NOT NULL, name TEXT NOT NULL, icon TEXT, color INTEGER NOT NULL DEFAULT 0,
  direction INTEGER NOT NULL CHECK (direction IN (1,2)),
  period_unit INTEGER NOT NULL CHECK (period_unit IN (1,2,3,4,5)),   -- 1 day 2 week 3 month 4 year 5 custom
  period_interval INTEGER NOT NULL DEFAULT 1 CHECK (period_interval >= 1),
  anchor_local_date INTEGER NOT NULL, custom_end_local_date INTEGER,
  limit_minor INTEGER NOT NULL CHECK (limit_minor >= 0), currency TEXT NOT NULL,
  scope_group_id BLOB, include_transfers INTEGER NOT NULL DEFAULT 0,
  rollover INTEGER NOT NULL DEFAULT 0 CHECK (rollover IN (0,1,2)),
  allocation_minor INTEGER NOT NULL CHECK (allocation_minor >= 0),
  funded_from_account_id BLOB, deleted INTEGER NOT NULL DEFAULT 0,
  PRIMARY KEY (fold_id, id)
) STRICT;
CREATE TABLE budget_scope_account  (fold_id BLOB NOT NULL REFERENCES fold(fold_id) ON DELETE CASCADE, budget_id BLOB NOT NULL, account_id  BLOB NOT NULL, PRIMARY KEY(fold_id,budget_id,account_id))  STRICT, WITHOUT ROWID;
CREATE TABLE budget_scope_category (fold_id BLOB NOT NULL REFERENCES fold(fold_id) ON DELETE CASCADE, budget_id BLOB NOT NULL, category_id BLOB NOT NULL, PRIMARY KEY(fold_id,budget_id,category_id)) STRICT, WITHOUT ROWID;
CREATE TABLE budget_scope_tag      (fold_id BLOB NOT NULL REFERENCES fold(fold_id) ON DELETE CASCADE, budget_id BLOB NOT NULL, tag_id      BLOB NOT NULL, PRIMARY KEY(fold_id,budget_id,tag_id))      STRICT, WITHOUT ROWID;

CREATE TABLE goal (
  fold_id BLOB NOT NULL REFERENCES fold(fold_id) ON DELETE CASCADE, id BLOB NOT NULL, name TEXT NOT NULL, icon TEXT, color INTEGER NOT NULL DEFAULT 0,
  target_minor INTEGER NOT NULL CHECK (target_minor > 0), currency TEXT NOT NULL,
  target_local_date INTEGER NOT NULL, account_id BLOB NOT NULL, deleted INTEGER NOT NULL DEFAULT 0,
  PRIMARY KEY (fold_id, id)
) STRICT;

CREATE TABLE schedule (
  fold_id BLOB NOT NULL REFERENCES fold(fold_id) ON DELETE CASCADE, id BLOB NOT NULL, kind INTEGER NOT NULL CHECK (kind IN (1,2)),   -- 1 transaction, 2 transfer
  template BLOB NOT NULL,                                                                  -- CBOR of the template (§4.4)
  begin_local_date INTEGER NOT NULL, end_local_date INTEGER,
  unit INTEGER NOT NULL CHECK (unit IN (1,2,3,4)), interval INTEGER NOT NULL CHECK (interval >= 1),
  requires_confirmation INTEGER NOT NULL DEFAULT 0, reminder_min INTEGER, completed_utc_ms INTEGER,
  deleted INTEGER NOT NULL DEFAULT 0, PRIMARY KEY (fold_id, id)
) STRICT;

CREATE TABLE fx_rate (
  fold_id BLOB NOT NULL REFERENCES fold(fold_id) ON DELETE CASCADE, id BLOB NOT NULL, quote TEXT NOT NULL, as_of_utc_s INTEGER NOT NULL,
  rate_e12 INTEGER NOT NULL CHECK (rate_e12 > 0), source TEXT,
  PRIMARY KEY (fold_id, id)
) STRICT;
CREATE UNIQUE INDEX fx_rate_lookup ON fx_rate(fold_id, quote, as_of_utc_s);

CREATE TABLE import_batch (fold_id BLOB NOT NULL REFERENCES fold(fold_id) ON DELETE CASCADE, id BLOB NOT NULL, source TEXT, imported_utc_ms INTEGER NOT NULL, undone INTEGER NOT NULL DEFAULT 0, PRIMARY KEY(fold_id,id)) STRICT;

-- Written when a from_join member is invited so balances and rollover carry-in start at the join date (table 14).
CREATE TABLE checkpoint (
  fold_id BLOB NOT NULL REFERENCES fold(fold_id) ON DELETE CASCADE, id BLOB NOT NULL,
  kind INTEGER NOT NULL CHECK (kind IN (1,2)),                       -- 1 account_balance, 2 envelope_carry
  subject BLOB NOT NULL, as_of_local_date INTEGER NOT NULL, value_minor INTEGER NOT NULL,
  PRIMARY KEY (fold_id, id)
) STRICT;
