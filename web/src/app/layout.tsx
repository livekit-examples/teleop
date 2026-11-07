import './globals.css';

import { cn } from '@/lib/utils';
import type { Metadata } from 'next';
import Image from 'next/image';

import wordmark from '../../public/lk-wordmark.svg';
import { displayFont, monoFont, sansFont } from '@/lib/fonts';
import { Toaster } from '@/components/ui/toaster';

export const metadata: Metadata = {
  title: 'Teleop · LiveKit',
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
      <body className="lk-dot-grid text-foreground min-h-screen overflow-hidden font-mono">
        {/* Header */}
        <header className="fixed top-6 left-6 z-50 flex items-center gap-3">
          <Image src={wordmark} alt="LiveKit" className="h-4 w-auto" priority />
          <span className="h-4 w-px bg-[var(--lk-separator2)]" aria-hidden="true" />
          <h1 className="font-mono text-xs tracking-[0.12em] text-[var(--lk-fg3)] uppercase">
            Robotics
          </h1>
        </header>

        {children}
        <Toaster />
      </body>
    </html>
  );
}
