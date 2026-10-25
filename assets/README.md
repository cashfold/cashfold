# Logos and images

Every logo, icon and picture in the project comes from this folder or is made from it. **All of
them are placeholders today.** This page lists what to replace and how.

## Replace the logo in three steps

1. Replace [`logo/mark.svg`](logo/mark.svg) with the real mark.
2. Run `pnpm gen:assets`. It rebuilds every derived file below (needs Chromium once:
   `pnpm exec playwright install chromium`).
3. Look at the result, then commit the changed files. `pnpm test` checks sizes and file names.

The mark is a **square SVG, 1024 × 1024, with the artwork inside the middle 80 percent**, so a rounded
or circular mask never cuts it. Draw the background into it (the app icon on the desktop and the
home screen is this image as it is). Convert text to paths, so it looks the same everywhere.

## The files

### You provide

| File                                                     | What it is                                                           | Used by                                                         |
| -------------------------------------------------------- | -------------------------------------------------------------------- | --------------------------------------------------------------- |
| [`logo/mark.svg`](logo/mark.svg)                         | The master mark, the source of everything under "Made from the mark" | `pnpm gen:assets`                                               |
| [`social/social-preview.png`](social/social-preview.png) | 1280 × 640, shown when the repository is shared                      | GitHub, once uploaded (see below)                               |
| [`screenshots/`](screenshots)                            | 1600 × 1000 pictures of the app (`01-overview.png` and so on)        | The README and the documentation, once you add them (see below) |

`pnpm gen:assets` creates the social preview and the screenshots **only when they are missing**, so
it never overwrites a real image. To get a fresh placeholder, delete the file and run it again.

### Made from the mark

Do not edit these by hand; the next `pnpm gen:assets` overwrites them.

| File                                              | What it is                                       | Used by                                                                           |
| ------------------------------------------------- | ------------------------------------------------ | --------------------------------------------------------------------------------- |
| `logo/logo-light.svg`, `logo/logo-dark.svg`       | The mark with the name, for light and dark pages | The README                                                                        |
| `../apps/desktop/build/icon.png`                  | 1024 × 1024 app icon                             | The desktop installers: electron-builder makes the `.ico` and the `.icns` from it |
| `../apps/web/public/favicon.ico`                  | 16, 32 and 48 pixel icons                        | Browser tabs                                                                      |
| `../apps/web/public/icon.svg`                     | The mark                                         | Browser tabs and the manifest                                                     |
| `../apps/web/public/apple-touch-icon.png`         | 180 × 180                                        | iPhone and iPad home screens                                                      |
| `../apps/web/public/icon-192.png`, `icon-512.png` | 192 and 512 pixels                               | Installing the web app (`manifest.webmanifest`)                                   |
| `../apps/web/public/icon-maskable-512.png`        | 512 pixels, artwork in the middle 70 percent     | Android and others that crop icons to a shape                                     |
| `../apps/web/public/manifest.webmanifest`         | The web app manifest: name, colours, icons       | Browsers; linked from `apps/web/src/app/layout.tsx`                               |

The brand colour is set at the top of [`scripts/gen-brand-assets.mjs`](../scripts/gen-brand-assets.mjs)
(`BRAND`, the app's `--primary`). Change it there, and in `apps/web/src/app/tokens.css` and the two
`themeColor` values in `layout.tsx`, if the new logo has a different colour.

## Things GitHub needs by hand

- **Social preview.** Upload `social/social-preview.png` under _Settings → General → Social
  preview_. GitHub has no API for it.
- **Repository description and topics** under the same page.

## Adding screenshots to the README

Replace the four placeholders in [`screenshots/`](screenshots) with real screenshots at the same file
names (keep them at 1600 × 1000, or any size of at least 800 pixels wide), then add them to the
README, for example:

```html
<p align="center">
  <img src="assets/screenshots/01-overview.png" alt="The overview screen" width="800" />
</p>
```

Give each image a short, accurate `alt` text. Do not show real financial data.

## Not wired up yet

These are common extras that the app does not use today. Add them when you want them:

- A disk image background for the macOS installer, and the sidebar and header pictures of the
  Windows installer (electron-builder `dmg.background` and the NSIS options).
- A tray or menu-bar icon.
- Separate icon sizes for Linux (`build/icons/<size>x<size>.png`); the single 1024-pixel icon is
  scaled today.

## License of the artwork

The placeholders are generated by this repository and carry the project's license. When you draw or
commission the real logo, record here who made it, under which license it is published, and any
rules for using the name and logo (for example for forks and packages).
