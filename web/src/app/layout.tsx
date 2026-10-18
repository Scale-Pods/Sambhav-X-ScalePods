import type { Metadata } from "next";
import "./globals.css";

export const metadata: Metadata = {
  title: "Sambhav Stock",
  description: "Stock, orders and quotations for Sambhav Pipes & Fittings",
  robots: { index: false, follow: false },
};

export default function RootLayout({ children }: LayoutProps<"/">) {
  return (
    <html lang="en" className="h-full antialiased">
      <body className="min-h-full">{children}</body>
    </html>
  );
}
