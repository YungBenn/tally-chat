import type { Metadata } from "next";
import { Inter, JetBrains_Mono } from "next/font/google";
import "./globals.css";
import { ConvexAuthNextjsServerProvider } from "@convex-dev/auth/nextjs/server";
import ConvexClientProvider from "@/components/ConvexClientProvider";

const inter = Inter({ variable: "--font-inter", subsets: ["latin"] });
const jetbrainsMono = JetBrains_Mono({
  variable: "--font-jetbrains-mono",
  subsets: ["latin"],
});

// Wensity's dark tokens hang off a .dark class; follow the OS setting before first paint.
const colorScheme = `(()=>{const m=matchMedia("(prefers-color-scheme: dark)");const s=()=>document.documentElement.classList.toggle("dark",m.matches);s();m.addEventListener("change",s)})()`;

export const metadata: Metadata = {
  title: "tally.chat",
  description: "The chat app that shows you what you are paying for.",
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
        className={`${inter.variable} ${jetbrainsMono.variable}`}
        suppressHydrationWarning
      >
        <head>
          <script dangerouslySetInnerHTML={{ __html: colorScheme }} />
        </head>
        <body className="font-sans antialiased">
          <ConvexClientProvider>{children}</ConvexClientProvider>
        </body>
      </html>
    </ConvexAuthNextjsServerProvider>
  );
}
