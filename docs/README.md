# Documentation

| Page                                      | What it covers                                                                              |
| ----------------------------------------- | ------------------------------------------------------------------------------------------- |
| [Architecture](ARCHITECTURE.md)           | The design: keys and sign-in, the data model, sync, sharing, the relay and client hardening |
| [The ledger](ledger.md)                   | How accounts, transactions and exchange rates are stored, merged and read                   |
| [Sync across devices](sync.md)            | How devices stay in step through a relay that sees only ciphertext                          |
| [Wire protocol](protocol.md)              | The relay's endpoints and wire formats. Generated from the schemas; do not edit by hand     |
| [Languages](i18n.md)                      | How the language is chosen, where the text lives, and how to add or change a message        |
| [Privacy](privacy.md)                     | What the service can see, and what privacy mode hides                                       |
| [Running your own relay](self-hosting.md) | Install the sync service with Docker and publish the web app                                |
| [The desktop app](desktop.md)             | Building, releasing and setting up the repository                                           |

Pages that are generated say so in their first line: change the generator, not the page. Format with `pnpm format:docs`; CI runs `pnpm check:docs`.
