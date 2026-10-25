# cashfold
Local-first, zero-trust personal finance platform. Zero-knowledge cryptography meets seamless envelope budgeting and cross-device CRDT sync.

## Downloads

Cashfold runs in the browser, and as an app for **Windows**, **macOS** and **Linux**. Download the one for your system from the [releases page](https://github.com/cashfold/cashfold/releases/latest): Windows (installer), macOS (disk image; Apple silicon and Intel), Linux (AppImage, `.deb`, `.rpm`). It is the same app with the same account and data format, in its own window, with your data kept in your computer's application-data folder. The app tells you when a new version is available and installs it only when you say so.

Until the installers are code-signed, the release says **UNSIGNED BUILD** at the top and your system will warn you the first time you open the app (macOS: Control-click, then Open; Windows: More info, then Run anyway).

Check what you downloaded:

```bash
sha256sum -c SHA256SUMS --ignore-missing
gh attestation verify <file> --repo cashfold/cashfold
```

For developers: `pnpm --filter @cashfold/desktop dev` runs the app from source. How it is built, tested, released and signed is in [docs/desktop.md](docs/desktop.md).


## Languages

Cashfold is available in **English**, **Українська** (Ukrainian) and **Polski** (Polish). It follows your browser's or system's language, and you can choose another while creating your account, and change it later in Settings → Appearance. The choice stays on your device. How the translations work, and how to add a language, is in [docs/i18n.md](docs/i18n.md).
