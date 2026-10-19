-- 0003: the one shared exchange-rate table (FR-103). No per-user data. Rates are decimal strings, never floats.
CREATE TABLE rate_table (
  as_of  bigint PRIMARY KEY,                    -- epoch ms
  base   text NOT NULL DEFAULT 'USD',
  rates  jsonb NOT NULL,
  source text NOT NULL
);
