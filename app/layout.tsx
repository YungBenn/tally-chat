import type { Metadata, Viewport } from "next";
import Script from "next/script";
import { GeistSans } from "geist/font/sans";
import { GeistMono } from "geist/font/mono";
import "./globals.css";
import { ConvexAuthNextjsServerProvider } from "@convex-dev/auth/nextjs/server";
import ConvexClientProvider from "@/components/ConvexClientProvider";
import AppProviders from "@/components/AppProviders";

// The design system's dark tokens hang off a .dark class; follow the OS setting before first paint.
const colorScheme = `(()=>{const m=matchMedia("(prefers-color-scheme: dark)");const s=()=>document.documentElement.classList.toggle("dark",m.matches);s();m.addEventListener("change",s)})()`;

export const metadata: Metadata = {
  title: "tally.chat",
  description: "The chat app that shows you what you are paying for.",
  // Home-screen install on iOS (the web app manifest covers other platforms); its icon is
  // app/apple-icon.png.
  appleWebApp: {
    capable: true,
    title: "tally.chat",
    statusBarStyle: "default",
  },
};

export const viewport: Viewport = {
  themeColor: [
    { media: "(prefers-color-scheme: light)", color: "#faf9f7" },
    { media: "(prefers-color-scheme: dark)", color: "#0c0c0b" },
  ],
};

export default function RootLayout({
  children,
}: Readonly<{
  children: React.ReactNode;
}>) {
  return (
    <ConvexAuthNextjsServerProvider>
      <html
        lang="en"
        className={`${GeistSans.variable} ${GeistMono.variable}`}
        suppressHydrationWarning
      >
        <head>
          <Script id="color-scheme" strategy="beforeInteractive">
            {colorScheme}
          </Script>
        </head>
        <body className="font-sans antialiased">
          <ConvexClientProvider>
            <AppProviders>{children}</AppProviders>
          </ConvexClientProvider>
        </body>
      </html>
    </ConvexAuthNextjsServerProvider>
  );
}
