import type { Metadata, Viewport } from 'next';
import type { ReactNode } from 'react';
import { THEME_BOOT } from '@/components/ThemeSwitch';
import './globals.css';

export const metadata: Metadata = {
  title: { default: 'Gatehouse', template: '%s · Gatehouse' },
  description: 'Gate and reception check-in for visitors, contractors and truck drivers.',
};

export const viewport: Viewport = {
  width: 'device-width',
  initialScale: 1,
  themeColor: [{ media: '(prefers-color-scheme: light)', color: '#f3efe6' }, { media: '(prefers-color-scheme: dark)', color: '#111213' }],
};

export default function RootLayout({ children }: { children: ReactNode }) {
  return (
    <html lang="en" suppressHydrationWarning>
      <head>
        <script dangerouslySetInnerHTML={{ __html: THEME_BOOT }} />
      </head>
      <body className="min-h-dvh">
        <div className="barrier" />
        {children}
      </body>
    </html>
  );
}
