# Documentation

Find the page for what you want to do. Questions that none of these answer go to [SUPPORT.md](../SUPPORT.md).

## Use Cashfold

| I want to…                                       | Read                                                           |
| ------------------------------------------------ | -------------------------------------------------------------- |
| install the app and check my download            | [README, Get Cashfold](../README.md#get-cashfold)              |
| know where the desktop app keeps my data         | [The desktop app](desktop.md#where-the-data-lives)             |
| fix a desktop problem, such as the first warning | [The desktop app, Troubleshooting](desktop.md#troubleshooting) |
| know exactly what the service can see about me   | [What the service can see](privacy.md)                         |
| change the language, or add one                  | [Languages](i18n.md)                                           |

## Run a relay

| I want to…                               | Read                                                                                 |
| ---------------------------------------- | ------------------------------------------------------------------------------------ |
| run my own relay and publish the web app | [Running your own relay](self-hosting.md)                                            |
| look up a relay setting                  | [Running your own relay, Settings](self-hosting.md#settings)                         |
| back up or upgrade a relay               | [Running your own relay, Backups and upgrades](self-hosting.md#backups-and-upgrades) |
| let the desktop app reach my relay       | [The desktop app, Using your own relay](desktop.md#using-your-own-relay)             |

## Understand how it works

| I want to…                                                            | Read                                                              |
| --------------------------------------------------------------------- | ----------------------------------------------------------------- |
| see the whole design                                                  | [Architecture](ARCHITECTURE.md), which opens with a reading guide |
| understand how devices stay in step                                   | [Sync across devices](sync.md)                                    |
| understand how accounts, transactions and rates are stored and merged | [The ledger](ledger.md)                                           |
| read the relay's endpoints and wire formats                           | [Wire protocol](protocol.md) (generated from the schemas)         |

## Work on Cashfold

| I want to…                                    | Read                                                                           |
| --------------------------------------------- | ------------------------------------------------------------------------------ |
| set up, test and open a pull request          | [CONTRIBUTING.md](../CONTRIBUTING.md)                                          |
| write code and tests the way the project does | [CODING_STANDARDS.md](../CODING_STANDARDS.md)                                  |
| build, package and release the desktop app    | [The desktop app](desktop.md#working-on-it), [Releasing](desktop.md#releasing) |
| report a vulnerability                        | [SECURITY.md](../SECURITY.md)                                                  |

Pages that are generated say so in their first line: change the generator, not the page. Format with
`pnpm format:docs`; CI runs `pnpm check:docs`.
