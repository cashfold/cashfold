# `@cashfold/platform`

The contract between the [desktop shell](../../apps/desktop/README.md) and the web page it shows: the
names of the IPC channels, the schemas of every request and answer, and the one global the page can
reach.

Both sides use it. The shell checks each argument against these schemas and refuses anything else,
and the page checks each answer. The page can do no more than this contract allows, so changes here
change the security surface of the desktop app.

## Entry points

| Import                        | What it is                                                               |
| ----------------------------- | ------------------------------------------------------------------------ |
| `@cashfold/platform`          | The schemas (`zod`), the `DesktopBridge` type and the name of the global |
| `@cashfold/platform/channels` | The channel names alone, for code that must not load the schemas         |

## Rules for this package

- Each channel does one thing, takes no path, URL or command from the page, and has a strict schema.
  An unexpected argument is a refusal.
- Changes need two reviewers and a threat-model note; see
  [Contributing](../../CONTRIBUTING.md#security-sensitive-changes) and
  [`.github/CODEOWNERS`](../../.github/CODEOWNERS).

## Test

```sh
pnpm --filter @cashfold/platform typecheck
pnpm --filter @cashfold/platform test
```
