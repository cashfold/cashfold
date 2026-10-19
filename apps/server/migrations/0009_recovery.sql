-- 0009: the optional Recovery Key credential (ARCH 6.8): a second SRP verifier and the key set's private keys wrapped under the
-- key, both opaque to the relay. One per account; removed with it.
CREATE TABLE account_recovery (
  account_id text PRIMARY KEY REFERENCES account(account_id) ON DELETE CASCADE,
  uuid       bytea NOT NULL,
  auth_salt  bytea NOT NULL,
  srp_v      bytea NOT NULL,
  wrapped    bytea NOT NULL
);
