import type { Metadata, Viewport } from 'next';
import type { ReactNode } from 'react';
import { THEME_BOOTSTRAP } from '../ui/theme/bootstrap';
import { AppProviders } from './providers';
import './globals.css';

export const metadata: Metadata = {
  // The title is the brand, the same in every language; a description would have to be in one language only (spec 004, FR-008, FR-009).
  title: 'Cashfold',
  // The files are in public/ and made by `pnpm gen:assets` from assets/logo/mark.svg.
  manifest: '/manifest.webmanifest',
  icons: {
    icon: [{ url: '/favicon.ico', sizes: '48x48' }, { url: '/icon.svg', type: 'image/svg+xml' }],
    apple: '/apple-touch-icon.png',
  },
};

// The brand colour of each theme (--primary in src/app/tokens.css): the browser's address bar and task switcher take it.
export const viewport: Viewport = {
  themeColor: [
    { media: '(prefers-color-scheme: light)', color: '#047857' },
    { media: '(prefers-color-scheme: dark)', color: '#10b981' },
  ],
};

export default function RootLayout({ children }: { children: ReactNode }) {
  return (
    <html lang="en" dir="ltr" suppressHydrationWarning>
      <head>
        {/* Sets data-theme before first paint; its hash is added to each page's Content-Security-Policy by harden-html.mjs. */}
        <script dangerouslySetInnerHTML={{ __html: THEME_BOOTSTRAP }} />
        {/* Only the Latin 400 and 500 files are preloaded; the other subsets load on demand through their unicode-range (R-UX-07). */}
        <link rel="preload" href="/fonts/ubuntu-latin-400-normal.woff2" as="font" type="font/woff2" crossOrigin="anonymous" />
        <link rel="preload" href="/fonts/ubuntu-latin-500-normal.woff2" as="font" type="font/woff2" crossOrigin="anonymous" />
      </head>
      <body>
        <AppProviders>{children}</AppProviders>
      </body>
    </html>
  );
}
