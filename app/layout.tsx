import type { Metadata } from 'next';
import './globals.css';

export const metadata: Metadata = { title: 'Laksh — The 24/7 Sports Exchange', description: 'Trade athlete futures contracts in real time.' };

export default function RootLayout({ children }: { children: React.ReactNode }) {
  return (
    <html lang="en" className="dark">
      <head>
        <link rel="preconnect" href="https://fonts.googleapis.com"/>
        <link rel="preconnect" href="https://fonts.gstatic.com" crossOrigin="anonymous"/>
        <link href="https://fonts.googleapis.com/css2?family=DM+Sans:wght@400;500;600;700;800&family=JetBrains+Mono:wght@400;500;600&display=swap" rel="stylesheet"/>
        <meta name="viewport" content="width=device-width, initial-scale=1, maximum-scale=1, viewport-fit=cover"/>
        <meta name="theme-color" content="#0b1120"/>
      </head>
      <body className="font-display bg-lk-bg text-lk-text antialiased">{children}</body>
    </html>
  );
}
