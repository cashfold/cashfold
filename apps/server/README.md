# `@cashfold/server`

The Cashfold **relay**: a small NestJS service that devices sync through. It stores and forwards
sealed data and cannot read it. There is no domain model here, only authentication, ordering,
storage and quotas.

For what it can and cannot see, read [What the service can see](../../docs/privacy.md). To run one,
read [Running your own relay](../../docs/self-hosting.md). The wire protocol is in the generated
[protocol reference](../../docs/protocol.md).

## Layout

| Path            | What it holds                                                                                                           |
| --------------- | ----------------------------------------------------------------------------------------------------------------------- |
| `src/app.ts`    | Builds the application: transport, rate limits and exception handling                                                   |
| `src/config.ts` | Reads and validates the environment (see below)                                                                         |
| `src/modules/`  | `auth` (SRP sign-in and the sealed frame), `accounts`, `devices`, `folds`, `membership`, `attachments`, `rates`, `mail` |
| `src/store/`    | The storage contract, with a PostgreSQL store and an in-memory store                                                    |
| `migrations/`   | SQL migrations, applied at start                                                                                        |
| `test/`         | Relay scenarios, run against both stores                                                                                |

## Run it

```sh
pnpm --filter @cashfold/server build
STORE=memory SERVER_SECRET=$(openssl rand -hex 32) node apps/server/dist/main.js
curl http://127.0.0.1:8080/healthz
```

`STORE=memory` keeps everything in the process and is for trials and tests only. For a real service
use PostgreSQL through the Docker setup in [`deploy/`](../../deploy), described in
[Running your own relay](../../docs/self-hosting.md).

## Settings

All settings are environment variables. The complete table, with defaults, is in
[Running your own relay](../../docs/self-hosting.md#settings). The relay refuses to start when a
required value is missing or invalid.

| Variable                | Purpose                                                                                                          |
| ----------------------- | ---------------------------------------------------------------------------------------------------------------- |
| `SERVER_SECRET`         | Required. At least 64 hex characters; keys the lookups and the stand-in answers for unknown addresses            |
| `STORE`, `DATABASE_URL` | `memory`, or PostgreSQL                                                                                          |
| `TRUST_PROXY`           | Which peers may set the client address in `X-Forwarded-For`; the default trusts only loopback and private ranges |
| `RATE_LIMIT_SCALE`      | Multiplies every rate limit; a number greater than 0                                                             |

## Test

```sh
pnpm --filter @cashfold/server test               # unit and relay scenarios, in memory
pnpm --filter @cashfold/server test:integration   # the same against PostgreSQL (needs Docker)
```

## Related

[Architecture](../../docs/ARCHITECTURE.md) (the service,
section 9) · [Contributing](../../CONTRIBUTING.md)
