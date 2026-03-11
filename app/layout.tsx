import type { Metadata, Viewport } from "next";
import "./globals.css";

export const metadata: Metadata = {
  title: "AI Traffic JA — Live Vehicle Detection",
  description: "Real-time AI-powered traffic monitoring for Jamaica. Watch live YOLO vehicle detection and predict traffic counts to win points.",
  keywords: ["traffic", "Jamaica", "AI", "vehicle detection", "YOLO", "live camera"],
  authors: [{ name: "Whitelinez" }],
  openGraph: {
    title: "AI Traffic JA — Live Vehicle Detection",
    description: "Real-time AI traffic monitoring. Predict vehicle counts and win points.",
    url: "https://aitrafficja.com",
    siteName: "AI Traffic JA",
    type: "website",
  },
  twitter: {
    card: "summary_large_image",
    title: "AI Traffic JA — Live Vehicle Detection",
    description: "Real-time AI traffic monitoring. Predict vehicle counts and win points.",
  },
  robots: { index: true, follow: true },
};

export const viewport: Viewport = {
  width: "device-width",
  initialScale: 1,
  themeColor: "#080C14",
};

export default function RootLayout({
  children,
}: Readonly<{ children: React.ReactNode }>) {
  return (
    <html lang="en" className="dark">
      <head>
        {/* Preconnect for Google Fonts — loaded via <link> to allow multiple families */}
        {/* eslint-disable-next-line @next/next/no-page-custom-font */}
        <link rel="preconnect" href="https://fonts.googleapis.com" />
        <link rel="preconnect" href="https://fonts.gstatic.com" crossOrigin="anonymous" />
        {/* eslint-disable-next-line @next/next/no-page-custom-font */}
        <link
          rel="stylesheet"
          href="https://fonts.googleapis.com/css2?family=Archivo:wght@700;800&family=Rajdhani:wght@500;600;700&family=Inter:wght@400;500;600;700&family=JetBrains+Mono:wght@400;700&display=swap"
        />
        <script
          type="application/ld+json"
          dangerouslySetInnerHTML={{
            __html: JSON.stringify({
              "@context": "https://schema.org",
              "@type": "WebSite",
              name: "AI Traffic JA",
              url: "https://aitrafficja.com",
              description: "Real-time AI-powered traffic monitoring and prediction game for Jamaica.",
            }),
          }}
        />
      </head>
      <body className="bg-background text-foreground antialiased">
        {children}
      </body>
    </html>
  );
}
