import type { ReactNode } from 'react';
import { AppProviders } from './providers';
import './globals.css';

export const metadata = { title: 'Cashfold', description: 'Private personal finance, encrypted on your device.' };

export default function RootLayout({ children }: { children: ReactNode }) {
  return (
    <html lang="en" dir="ltr">
      <body>
        <AppProviders>{children}</AppProviders>
      </body>
    </html>
  );
}
