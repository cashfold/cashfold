-- 0001: accounts and devices (ARCHITECTURE 9.7). The server holds the SRP verifier and ciphertext key sets, never a password or key.
CREATE TABLE account (
  account_id   text PRIMARY KEY CHECK (account_id ~ '^[A-Z2-9]{6}$'),     -- the public 6-character id (no 0, 1, I, O)
  email_hmac   bytea UNIQUE NOT NULL CHECK (length(email_hmac) = 32),     -- HMAC-SHA256(server secret, lower(email)): lookups never use the address
  email        text NOT NULL,                                             -- kept to deliver mail only
  auth_salt    bytea NOT NULL CHECK (length(auth_salt) = 16),
  kdf          jsonb NOT NULL,                                            -- {kdf, m_kib/t/p or iter, enc_salt hex}
  srp_v        bytea NOT NULL CHECK (length(srp_v) = 512),
  keyset       bytea NOT NULL,                                            -- CBOR key set; private keys are ciphertext
  fail_count   integer NOT NULL DEFAULT 0,
  locked_until bigint,                                                    -- epoch ms
  created_at   bigint NOT NULL
);

CREATE TABLE device (
  dev_id     bytea PRIMARY KEY CHECK (length(dev_id) = 16),
  account_id text NOT NULL REFERENCES account(account_id) ON DELETE CASCADE,
  sig_pk     bytea NOT NULL CHECK (length(sig_pk) = 32),
  label_ct   bytea,
  created_at bigint NOT NULL,
  revoked_at bigint
);
CREATE INDEX device_account ON device(account_id, created_at);

-- Lets the devices of a deleted account learn of it (410 Gone) without the server keeping any content.
CREATE TABLE tombstone_account (
  account_id text PRIMARY KEY,
  deleted_at bigint NOT NULL
);
