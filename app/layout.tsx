import type { Metadata } from 'next';
import './globals.css';

export const metadata: Metadata = {
  title: 'Laksh — The 24/7 Sports Market',
  description: 'Buy and sell NBA player shares. Prices update every 5 seconds. Everything settles at season end.',
  openGraph: {
    title: 'Laksh — The 24/7 Sports Market',
    description: 'Buy and sell NBA player shares. Prices update every 5 seconds. Everything settles at season end.',
    url: 'https://laksh.app',
    siteName: 'Laksh',
    type: 'website',
  },
  twitter: {
    card: 'summary_large_image',
    title: 'Laksh — The 24/7 Sports Market',
    description: 'Buy and sell NBA player shares. Prices update every 5 seconds. Everything settles at season end.',
  },
  metadataBase: new URL('https://laksh.app'),
};

export default function RootLayout({ children }: { children: React.ReactNode }) {
  return (
    <html lang="en" className="dark">
      <head>
        <link rel="preconnect" href="https://fonts.googleapis.com"/>
        <link rel="preconnect" href="https://fonts.gstatic.com" crossOrigin="anonymous"/>
        <link href="https://fonts.googleapis.com/css2?family=DM+Sans:wght@400;500;600;700;800&family=JetBrains+Mono:wght@400;500;600&display=swap" rel="stylesheet"/>
        <link rel="icon" href="/favicon.svg" type="image/svg+xml"/>
        <meta name="viewport" content="width=device-width, initial-scale=1, maximum-scale=1, viewport-fit=cover"/>
        <meta name="theme-color" content="#0b1120"/>
      </head>
      <body className="font-display bg-lk-bg text-lk-text antialiased">{children}</body>
    </html>
  );
}
