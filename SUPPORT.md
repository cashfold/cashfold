# Getting help

Cashfold is maintained by volunteers. There is no commercial support, and answers come on a
best-effort basis. These steps get you a useful answer fastest.

## 1. Look in the documentation

The [documentation index](docs/README.md) lists every page. These answer most questions:

| Question                                                | Page                                                                                 |
| ------------------------------------------------------- | ------------------------------------------------------------------------------------ |
| How do I install the desktop app, and why does it warn? | [README](README.md#get-cashfold), [docs/desktop.md](docs/desktop.md#troubleshooting) |
| How do I run my own relay?                              | [docs/self-hosting.md](docs/self-hosting.md)                                         |
| What can the service see about me?                      | [docs/privacy.md](docs/privacy.md)                                                   |
| How does sync work, and what is not built yet?          | [docs/sync.md](docs/sync.md)                                                         |
| How does the app protect my data?                       | [docs/ARCHITECTURE.md](docs/ARCHITECTURE.md)                                         |

## 2. Search the issues

Someone may have met the same problem:
[search open and closed issues](https://github.com/cashfold/cashfold/issues?q=is%3Aissue).

## 3. Open an issue

- **A bug:** use the [bug report form](https://github.com/cashfold/cashfold/issues/new?template=bug_report.yml).
  Say which version you use (**Settings → Advanced → About**), on which system and browser, and how
  to make it happen again. Never paste your password, Secret Key, Recovery Key or Emergency Kit.
- **An idea:** use the
  [feature request form](https://github.com/cashfold/cashfold/issues/new?template=feature_request.yml).
- **A question:** open an issue with the `question` label.

## Security problems

Do not open an issue for a vulnerability. Report it privately; see [SECURITY.md](SECURITY.md).

## Lost access to your data

- **If you made a Recovery Key,** it gets you back in when you lose your password or your Secret Key.
  When you sign in, follow **Lost your password or Secret Key? Use your Recovery Key.**
- **Your Emergency Kit** holds your Secret Key (and your Recovery Key, if you made one). It does not
  hold your password.
- **If you have none of these,** nobody can recover your data, including the maintainers. That is how
  zero-knowledge works. See [what the service can see](docs/privacy.md) and the
  [architecture notes](docs/ARCHITECTURE.md).
