-- 0006: Fold-key grants, stored exactly as the clients sealed and signed them (ARCH 7.2). The relay cannot open one.
CREATE TABLE fold_grant (
  fold_id bytea NOT NULL REFERENCES fold(fold_id) ON DELETE CASCADE,
  member  text NOT NULL REFERENCES account(account_id) ON DELETE CASCADE,
  epoch   integer NOT NULL,
  grant_bytes bytea NOT NULL,
  PRIMARY KEY (fold_id, member, epoch)
);
