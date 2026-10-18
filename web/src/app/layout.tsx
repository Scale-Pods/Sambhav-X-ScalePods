import type { Metadata } from "next";
import localFont from "next/font/local";
import "./globals.css";

// Self-hosted variable fonts (files in ./fonts), so they always load, with no call to Google.
const head = localFont({ src: "./fonts/manrope-latin.woff2", weight: "600 800", variable: "--font-head", display: "swap" });
const body = localFont({ src: "./fonts/ibm-plex-sans-latin.woff2", weight: "400 700", variable: "--font-body", display: "swap" });
const deva = localFont({ src: "./fonts/noto-sans-devanagari.woff2", weight: "400 600", variable: "--font-deva", display: "swap" });

export const metadata: Metadata = {
  title: "Sambhav Stock",
  description: "Stock, orders and quotations for Sambhav Pipes & Fittings",
  robots: { index: false, follow: false },
};

// Set light / dark before the first paint, so the page never flashes the wrong colours.
const themeScript = `try{var t=localStorage.getItem("theme");var d=t?t==="dark":matchMedia("(prefers-color-scheme: dark)").matches;if(d)document.documentElement.classList.add("dark")}catch(e){}`;

export default function RootLayout({ children }: LayoutProps<"/">) {
  return (
    <html lang="en" className={`${head.variable} ${body.variable} ${deva.variable} h-full antialiased`} suppressHydrationWarning>
      <head>
        <script dangerouslySetInnerHTML={{ __html: themeScript }} />
      </head>
      <body className="min-h-full">{children}</body>
    </html>
  );
}
