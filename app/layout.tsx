import './globals.css';
import { Analytics } from '@vercel/analytics/react';
import { Suspense } from 'react';
import { JetBrains_Mono, Outfit } from 'next/font/google';

const jetbrainsMono = JetBrains_Mono({
  subsets: ['latin'],
  variable: '--font-display',
  display: 'swap',
});

const outfit = Outfit({
  subsets: ['latin'],
  variable: '--font-body',
  display: 'swap',
});

interface RootLayoutProps {
  children: React.ReactNode;
}

export default function RootLayout({ children }: RootLayoutProps) {
  return (
    <html lang="en" className={`h-full ${jetbrainsMono.variable} ${outfit.variable}`}>
      <body className="h-full">
        <Suspense fallback={<div>Loading...</div>}>
          {children}
        </Suspense>
        <Analytics />
      </body>
    </html>
  );
}
