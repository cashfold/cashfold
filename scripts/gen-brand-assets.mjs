// Derives every logo and icon from the one master file, assets/logo/mark.svg:  pnpm gen:assets
//
// Always rewritten from the mark (replace the mark, run this, commit the result):
//   assets/logo/logo-light.svg, logo-dark.svg      the mark with the name, for the README (light and dark themes)
//   apps/desktop/build/icon.png                    the desktop app icon; electron-builder makes the .ico and .icns from it
//   apps/desktop/build/tray/                       the tray and menu-bar icons (a macOS template image at 1x and 2x, a coloured one for Windows and Linux)
//   apps/web/public/icon.svg, favicon.ico, apple-touch-icon.png, icon-192.png, icon-512.png, icon-maskable-512.png, manifest.webmanifest
// Created only when missing, so a real image is never overwritten (delete one and run this to get a fresh placeholder):
//   apps/desktop/build/badges/1.png to 9.png, 9plus.png   the Windows taskbar overlay for a count of waiting entries (they hold digits, not the mark)
//   assets/social/social-preview.png               1280 x 640, uploaded by hand in the repository settings
//   assets/screenshots/*.png                       1600 x 1000 stand-ins for real screenshots
//
// It renders with Playwright's Chromium (`pnpm exec playwright install chromium` once).
import { chromium } from '@playwright/test';
import { existsSync, mkdirSync, readFileSync, writeFileSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';

const root = join(dirname(fileURLToPath(import.meta.url)), '..');
const at = (...parts) => join(root, ...parts);

// The brand colour of the app (apps/web/src/app/tokens.css: --primary in the light theme).
const BRAND = '#047857';
const NAME = 'Cashfold';
const TAGLINE = 'Local-first, zero-trust personal finance';

const mark = readFileSync(at('assets/logo/mark.svg'), 'utf8');
const markInner = mark.replace(/^[\s\S]*?<svg[^>]*>/, '').replace(/<\/svg>\s*$/, '');
const markData = `data:image/svg+xml;base64,${Buffer.from(mark).toString('base64')}`;

function write(path, content) {
  mkdirSync(dirname(path), { recursive: true });
  writeFileSync(path, content);
  console.log(`wrote ${path.slice(root.length + 1)}`);
}

/** The mark and the name side by side, as one SVG (the mark's shapes are copied in: an SVG shown in a README may not load another file). */
function lockup(textColour) {
  return `<svg xmlns="http://www.w3.org/2000/svg" width="900" height="256" viewBox="0 0 900 256" role="img" aria-label="${NAME}">
  <!-- PLACEHOLDER logo, generated from assets/logo/mark.svg by scripts/gen-brand-assets.mjs. Replace the mark, not this file. -->
  <g transform="scale(0.25)">${markInner}</g>
  <text x="296" y="168" font-family="Ubuntu, Inter, 'Segoe UI', system-ui, sans-serif" font-size="136" font-weight="500" fill="${textColour}">${NAME}</text>
</svg>
`;
}

const placeholderPage = (width, height, label, detail) => `
<body style="margin:0;width:${width}px;height:${height}px;display:flex;align-items:center;justify-content:center;background:#f4f4f5;
  font-family:Ubuntu,Inter,'Segoe UI',system-ui,sans-serif;color:#52525b;box-sizing:border-box">
  <div style="width:calc(100% - 96px);height:calc(100% - 96px);border:6px dashed #a1a1aa;border-radius:32px;display:flex;flex-direction:column;
    align-items:center;justify-content:center;gap:20px;text-align:center;box-sizing:border-box">
    <img src="${markData}" width="120" height="120" style="opacity:.55">
    <div style="font-size:56px;font-weight:500;color:#3f3f46">${label}</div>
    <div style="font-size:30px;max-width:80%">${detail}</div>
  </div>
</body>`;

const socialPage = `
<body style="margin:0;width:1280px;height:640px;display:flex;align-items:center;padding:0 112px;box-sizing:border-box;gap:56px;color:#ecfdf5;
  background:linear-gradient(135deg,#064e3b,${BRAND});font-family:Ubuntu,Inter,'Segoe UI',system-ui,sans-serif">
  <img src="${markData}" width="280" height="280" style="border-radius:62px;box-shadow:0 24px 60px rgba(0,0,0,.35)">
  <div>
    <div style="font-size:120px;font-weight:500;line-height:1.05">${NAME}</div>
    <div style="font-size:42px;margin-top:20px;opacity:.9">${TAGLINE}</div>
    <div style="font-size:28px;margin-top:36px;opacity:.7">Placeholder: replace assets/social/social-preview.png</div>
  </div>
</body>`;

const SCREENSHOTS = [
  ['01-overview.png', 'Overview', 'a screenshot of the overview screen: balances, budgets and what is coming up.'],
  ['02-transactions.png', 'Transactions', 'a screenshot of the transaction list, with the add sheet open.'],
  ['03-budgets.png', 'Budgets', 'a screenshot of the envelope budgets with rollover.'],
  ['04-desktop.png', 'Desktop app', 'a screenshot of the desktop app in its own window.'],
];

const browser = await chromium.launch();
try {
  /** Renders HTML at an exact size; transparent unless the page paints a background. */
  async function shot(html, width, height, path, { transparent = false } = {}) {
    const page = await browser.newPage({ viewport: { width, height }, deviceScaleFactor: 1 });
    // A page that brings its own <body> is used as it is; a fragment gets a transparent one.
    await page.setContent(html.trimStart().startsWith('<body') ? `<html>${html}</html>` : `<html><body style="margin:0;background:transparent">${html}</body></html>`);
    await page.waitForLoadState('load');
    mkdirSync(dirname(path), { recursive: true });
    await page.screenshot({ path, omitBackground: transparent, clip: { x: 0, y: 0, width, height } });
    await page.close();
    console.log(`wrote ${path.slice(root.length + 1)}`);
  }
  const square = (size) => `<img src="${markData}" width="${size}" height="${size}" style="display:block">`;
  const buffer = async (html, size) => {
    const page = await browser.newPage({ viewport: { width: size, height: size }, deviceScaleFactor: 1 });
    await page.setContent(`<html><body style="margin:0;background:transparent">${html}</body></html>`);
    await page.waitForLoadState('load');
    const png = await page.screenshot({ omitBackground: true, clip: { x: 0, y: 0, width: size, height: size } });
    await page.close();
    return png;
  };

  // Logos for the README.
  write(at('assets/logo/logo-light.svg'), lockup('#064e3b'));
  write(at('assets/logo/logo-dark.svg'), lockup('#ecfdf5'));

  // The desktop app icon: electron-builder needs a square PNG of at least 512 pixels and builds the .ico and .icns for each system from it.
  await shot(square(1024), 1024, 1024, at('apps/desktop/build/icon.png'), { transparent: true });

  // The web app: icons for browsers, home screens and installs.
  write(at('apps/web/public/icon.svg'), mark);
  await shot(square(180), 180, 180, at('apps/web/public/apple-touch-icon.png'), { transparent: true });
  await shot(square(192), 192, 192, at('apps/web/public/icon-192.png'), { transparent: true });
  await shot(square(512), 512, 512, at('apps/web/public/icon-512.png'), { transparent: true });
  // Maskable: the artwork sits inside the middle 70 percent on a full-bleed background, so any mask shape (circle, squircle) keeps it whole.
  await shot(
    `<div style="width:512px;height:512px;background:${BRAND};display:flex;align-items:center;justify-content:center">${square(358)}</div>`,
    512,
    512,
    at('apps/web/public/icon-maskable-512.png'),
  );
  // favicon.ico: three PNG images in an ICO container.
  const sizes = [16, 32, 48];
  const images = await Promise.all(sizes.map((size) => buffer(square(size), size)));
  const header = Buffer.alloc(6);
  header.writeUInt16LE(1, 2); // type: icon
  header.writeUInt16LE(sizes.length, 4);
  let offset = 6 + 16 * sizes.length;
  const entries = sizes.map((size, i) => {
    const entry = Buffer.alloc(16);
    entry.writeUInt8(size, 0);
    entry.writeUInt8(size, 1);
    entry.writeUInt16LE(1, 4); // colour planes
    entry.writeUInt16LE(32, 6); // bits per pixel
    entry.writeUInt32LE(images[i].length, 8);
    entry.writeUInt32LE(offset, 12);
    offset += images[i].length;
    return entry;
  });
  write(at('apps/web/public/favicon.ico'), Buffer.concat([header, ...entries, ...images]));
  write(
    at('apps/web/public/manifest.webmanifest'),
    `${JSON.stringify(
      {
        name: NAME,
        short_name: NAME,
        // No description: a static web app cannot offer one per language, so the installed app is known by its name alone (spec 004, FR-009).
        start_url: '/',
        scope: '/',
        display: 'standalone',
        background_color: '#ffffff',
        theme_color: BRAND,
        icons: [
          { src: '/icon-192.png', sizes: '192x192', type: 'image/png' },
          { src: '/icon-512.png', sizes: '512x512', type: 'image/png' },
          { src: '/icon-maskable-512.png', sizes: '512x512', type: 'image/png', purpose: 'maskable' },
          { src: '/icon.svg', sizes: 'any', type: 'image/svg+xml' },
        ],
      },
      null,
      2,
    )}\n`,
  );

  // The tray and menu-bar icons, from the mark. macOS wants a black template image with transparency, which it tints for light and dark menu bars
  // (the file name ends in "Template"); Windows and Linux get the coloured mark.
  const trayArc = (size) =>
    `<svg xmlns="http://www.w3.org/2000/svg" width="${size}" height="${size}" viewBox="240 240 544 544"><path d="M672.7 320.5 A250 250 0 1 0 672.7 703.5" fill="none" stroke="#000000" stroke-width="120" stroke-linecap="round"/></svg>`;
  await shot(trayArc(16), 16, 16, at('apps/desktop/build/tray/trayTemplate.png'), { transparent: true });
  await shot(trayArc(32), 32, 32, at('apps/desktop/build/tray/trayTemplate@2x.png'), { transparent: true });
  await shot(square(32), 32, 32, at('apps/desktop/build/tray/tray.png'), { transparent: true });
  await shot(square(64), 64, 64, at('apps/desktop/build/tray/tray@2x.png'), { transparent: true });

  // The count on the Windows taskbar button: Windows has no count API, so the overlay is a picture. Only made when missing.
  const badgeSvg = (label) =>
    `<svg xmlns="http://www.w3.org/2000/svg" width="32" height="32" viewBox="0 0 32 32"><circle cx="16" cy="16" r="16" fill="#b3261e"/><text x="16" y="${label.length > 1 ? 22 : 23}" text-anchor="middle" font-family="Arial, Helvetica, sans-serif" font-weight="700" font-size="${label.length > 1 ? 17 : 22}" fill="#ffffff">${label}</text></svg>`;
  for (const [file, label] of [...Array.from({ length: 9 }, (_, i) => [`${i + 1}.png`, String(i + 1)]), ['9plus.png', '9+']]) {
    if (!existsSync(at('apps/desktop/build/badges', file))) await shot(badgeSvg(label), 32, 32, at('apps/desktop/build/badges', file), { transparent: true });
  }

  // Placeholders that are only made when missing.
  if (!existsSync(at('assets/social/social-preview.png'))) await shot(socialPage, 1280, 640, at('assets/social/social-preview.png'));
  for (const [file, label, detail] of SCREENSHOTS) {
    if (!existsSync(at('assets/screenshots', file))) {
      await shot(placeholderPage(1600, 1000, `Screenshot placeholder: ${label}`, `Replace this file with ${detail}`), 1600, 1000, at('assets/screenshots', file));
    }
  }
} finally {
  await browser.close();
}
