import './globals.css';

import { cn } from '@/lib/utils';
import type { Metadata } from 'next';
import Image from 'next/image';

import logo from '../../public/logo.svg';
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
      <body
        className="min-h-screen overflow-hidden bg-size-[33dvh_33dvh] bg-center font-sans"
        style={{
          backgroundImage: [
            'linear-gradient(0deg, color-mix(in oklch, var(--primary-foreground) 10%, transparent) 1px, transparent 1px)',
            'linear-gradient(90deg, color-mix(in oklch, var(--primary-foreground) 10%, transparent) 1px, transparent 1px)',
          ].join(', '),
        }}
      >
        {/* Header */}
        <header className="fixed top-6 left-6 z-50 flex items-baseline gap-4">
          <Image src={logo} alt="TeleOps UI" className="size-4" />
          <h1 className="font-mono text-xl font-light tracking-widest text-white uppercase">
            Robotics
          </h1>
        </header>

        {children}
      </body>
    </html>
  );
}
