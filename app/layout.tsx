import './globals.css';
import { Analytics } from '@vercel/analytics/react';

import { Suspense } from 'react';


interface RootLayoutProps {
  children: React.ReactNode;
}


export default function RootLayout({ children }: RootLayoutProps) {
  // If a user is logged in, render the requested page
  return (
    <html lang="en" className="h-full bg-gray-50">
      <body className="h-full">
          <Suspense fallback={<div>Loading...</div>}>
          </Suspense>
          {children}
          <Analytics />
      </body>
    </html>
  );
}
