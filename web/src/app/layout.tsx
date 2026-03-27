import './globals.css';

import { cn } from '@/lib/utils';
import type { Metadata } from 'next';

import { displayFont, monoFont, sansFont } from '@/lib/fonts';

export const metadata: Metadata = {
  title: 'TeleOps UI',
  description: 'Robot teleoperation interface',
};

export default function RootLayout({
  children,
}: Readonly<{
  children: React.ReactNode;
}>) {
  return (
    <html
      lang="en"
      className={cn(sansFont.variable, displayFont.variable, monoFont.variable, 'dark')}
    >
      <body className="min-h-screen overflow-hidden font-(family-name:--font-lk-sans)">
        {children}
      </body>
    </html>
  );
}
