# Running your own relay

The relay is the small service your devices sync through. It stores encrypted data it cannot read: no amounts, names, notes,
dates, passwords or Secret Keys ever reach it (see [the threat model](threat-model.md)). You can use someone else's, or run your
own in a few minutes.

## What you need

* A machine with Docker and Docker Compose, reachable from the internet if your devices roam (a small VPS is plenty).
* A domain name and a reverse proxy that terminates TLS (Caddy, nginx, Traefik). The relay itself speaks plain HTTP and WebSocket
  and must only be reached over HTTPS.
* A place to serve the web app's static files (`apps/web/out`, from `pnpm --filter @cashfold/web build`): any static host.

## Steps

1. Copy the example settings and fill them in.

   ```sh
   cp deploy/example.env deploy/.env
   openssl rand -hex 32     # use the output for SERVER_SECRET
   openssl rand -hex 32     # and for POSTGRES_PASSWORD
   ```

   Set `ALLOWED_ORIGINS` and `PUBLIC_URL` to the address of your web app, for example `https://cashfold.example.com`.

2. Start it.

   ```sh
   docker compose -f deploy/compose.yml --env-file deploy/.env up -d --build
   ```

   The relay applies its database migrations on start and listens on `127.0.0.1:8080`. Check it: `curl http://127.0.0.1:8080/healthz`.

3. Point your reverse proxy at it. For Caddy:

   ```
   relay.example.com {
     reverse_proxy 127.0.0.1:8080
   }
   ```

   WebSocket upgrades must pass through (Caddy and nginx with `proxy_set_header Upgrade` do). Do not cache responses, and do not
   log request bodies.

4. Build the web app with your relay's address as the default, serve `apps/web/out`, and allow it to talk to the relay with the
   content security policy (`CSP_CONNECT_SOURCES=https://relay.example.com`, see `apps/web/headers.config.ts`).

   ```sh
   NEXT_PUBLIC_DEFAULT_SERVER=https://relay.example.com pnpm --filter @cashfold/web build
   ```

   People can still type another address when they sign up.

## Settings

All settings are environment variables; [`deploy/example.config.yml`](../deploy/example.config.yml) lists them with their defaults.

| Setting | Meaning |
|---|---|
| `SERVER_SECRET` | 32 random bytes as 64 hex characters. Used for keyed hashes of email addresses and to make unknown addresses look like real ones. **Back it up**: with a new secret nobody can sign in. |
| `DATABASE_URL` | PostgreSQL connection string. Without it the relay keeps everything in memory (testing only). |
| `REGISTRATION` | `open`, or `invite` to require a code from `INVITE_CODES`. Prefer `invite` on a public address. |
| `MAIL` | `smtp` sends confirmation links and lock-out notices; `none` turns email off (the app then says addresses are not confirmed); `log` writes messages to the log. |
| `RATES_URL` | A URL returning `{"rates": {"EUR": "0.91"}}` (units per US dollar, as text). The relay fetches it and publishes one table at `GET /rates`. `disabled` turns it off. |
| `RATE_LIMIT_SCALE` | Multiplies every rate limit (default 1). Leave it at 1 on a real service; test setups that sign in many accounts from one address raise it. |
| `ALLOWED_ORIGINS` | Web-app origins allowed to call the relay from a browser. |

## Backups and upgrades

* **Back up** the `pgdata` volume (`pg_dump cashfold`) and `SERVER_SECRET`. What is in the database is ciphertext: a stolen backup
  is no use without people's passwords and Secret Keys.
* **Upgrade** with `git pull && docker compose … up -d --build`. Migrations run before the relay accepts requests, inside a lock, so
  two copies starting together do not collide.
* Devices keep working offline while the relay is down and catch up afterwards.

## What the operator can and cannot see

You can see that accounts exist, their email addresses (as typed, to send confirmation mail) and device counts, when they connect,
and how large their encrypted data is. You cannot see anything in it. You can remove an account or a device; people lose sync, not
their data on their own devices. If you lose the database, devices still hold everything and can register with a fresh relay.
