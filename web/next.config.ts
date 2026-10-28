import type { NextConfig } from "next";

const nextConfig: NextConfig = {
  /* config options here */
  cacheComponents: true,
  // PDF page rendering (WebAssembly) and image resizing run as plain Node packages, not bundled
  serverExternalPackages: ["mupdf", "sharp"],
  partialPrefetching: true,
  // the site may not be shown inside another site (clickjacking), and browsers must not guess file types or leak the full address to other sites
  async headers() {
    return [{
      source: "/:path*",
      headers: [
        { key: "X-Frame-Options", value: "DENY" },
        { key: "Content-Security-Policy", value: "frame-ancestors 'none'" },
        { key: "X-Content-Type-Options", value: "nosniff" },
        { key: "Referrer-Policy", value: "strict-origin-when-cross-origin" },
        { key: "Permissions-Policy", value: "camera=(self), microphone=(), geolocation=(), payment=()" },
        { key: "Strict-Transport-Security", value: "max-age=63072000; includeSubDomains" },
      ],
    }];
  },
  // the Digital Brain used to live at /ask: old links and bookmarks keep working
  async redirects() {
    return [
      { source: "/ask", destination: "/digital-brain", permanent: true },
      { source: "/ask/:path*", destination: "/digital-brain/:path*", permanent: true },
    ];
  },
  turbopack: {
    rules: {
      "*.css": {
        loaders: ["@tailwindcss/turbopack"],
        as: "*.css",
      },
    },
  },
};

export default nextConfig;
