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

4. Build the web app with your relay's address as the default, and pin the content security policy to it. Without
   `CSP_CONNECT_SOURCES` the app may talk to any `https://` or `wss://` service (people choose their own address at sign-up); set
   it to your relay to allow only that one.

   ```sh
   NEXT_PUBLIC_DEFAULT_SERVER=https://relay.example.com CSP_CONNECT_SOURCES=https://relay.example.com wss://relay.example.com \
     pnpm --filter @cashfold/web build
   ```

   With that setting people can still type another address, but the browser will refuse to reach it.

5. Serve `apps/web/out` with the headers in `apps/web/out/_headers` (written by the build; Netlify and Cloudflare Pages read it as it is).
   Every page already carries its own Content-Security-Policy and a no-referrer policy as `<meta>` tags, and every script and
   stylesheet is pinned by an integrity hash, so the app is protected even on a host that cannot set headers. Real headers add what a
   `<meta>` cannot: `frame-ancestors`, `Permissions-Policy` and HSTS. The Ubuntu font is served from the same origin under `/fonts/`
   (`font-src 'self'`, no third-party font host); the files are copied unmodified with their licence (`fonts/UFL.txt`). A small inline script
   sets the colour theme before the first paint; the page's policy allows exactly that script by hash. For Caddy:

   ```
   cashfold.example.com {
     root * /srv/cashfold
     file_server
     header {
       Content-Security-Policy "frame-ancestors 'none'; base-uri 'none'; object-src 'none'"
       Referrer-Policy "no-referrer"
       Permissions-Policy "camera=(), microphone=(), payment=(), usb=(), bluetooth=(), geolocation=(self), publickey-credentials-create=(self), publickey-credentials-get=(self)"
       X-Content-Type-Options "nosniff"
       X-Frame-Options "DENY"
       Cross-Origin-Opener-Policy "same-origin"
       Cross-Origin-Resource-Policy "same-origin"
       Strict-Transport-Security "max-age=63072000; includeSubDomains"
     }
     @sw path /sw.js /precache-manifest.json
     header @sw Cache-Control "no-cache"
     @static path /_next/static/*
     header @static Cache-Control "public, max-age=31536000, immutable"
   }
   ```

   Do not rewrite or minify the files after the build: the integrity hashes and the service worker's list of files would no longer
   match, and the app would refuse to run them. Releases publish the hash of every file (`SHA256SUMS`); you can rebuild a tag with
   `node scripts/build-verify.mjs` and compare.

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
