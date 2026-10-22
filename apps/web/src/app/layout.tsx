import type { ReactNode } from 'react';
import { THEME_BOOTSTRAP } from '../ui/theme/bootstrap';
import { AppProviders } from './providers';
import './globals.css';

export const metadata = { title: 'Cashfold', description: 'Private personal finance, encrypted on your device.' };

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
