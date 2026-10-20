-- 0005: email verification and discoverability (FR-105, FR-106).
ALTER TABLE account ADD COLUMN email_verified_at bigint;
ALTER TABLE account ADD COLUMN discoverable boolean NOT NULL DEFAULT true;

CREATE TABLE email_verification (
  account_id text NOT NULL REFERENCES account(account_id) ON DELETE CASCADE,
  token_hash bytea NOT NULL CHECK (length(token_hash) = 32),                -- the token itself is never stored
  expires_at bigint NOT NULL,
  used_at    bigint,
  PRIMARY KEY (account_id, token_hash)
);
CREATE UNIQUE INDEX email_verification_token ON email_verification(token_hash);
