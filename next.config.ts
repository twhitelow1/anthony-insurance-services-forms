import type { NextConfig } from "next";
import { EMBED_ORIGINS } from "./src/lib/brands";

const nextConfig: NextConfig = {
  // PGlite (embedded Postgres for local dev/tests) ships WASM; load it from node_modules as-is.
  serverExternalPackages: ["@electric-sql/pglite"],
  // Carrier PDF templates and SQL migrations are read from disk at runtime; ship them with the server functions.
  // Document library uploads (Admin → Documents) go through a server action; Vercel caps requests at 4.5MB.
  experimental: { serverActions: { bodySizeLimit: "4.5mb" } },
  // Only the public forms may be framed, and only by the agency's own websites;
  // everything else (admin, portal, PDFs) refuses to load in a frame.
  async headers() {
    return [
      { source: "/forms/:path*", headers: [{ key: "Content-Security-Policy", value: `frame-ancestors 'self' ${EMBED_ORIGINS.join(" ")}` }] },
      {
        source: "/:path((?!forms/).*)",
        headers: [
          { key: "Content-Security-Policy", value: "frame-ancestors 'self'" },
          { key: "X-Frame-Options", value: "SAMEORIGIN" },
        ],
      },
    ];
  },
  outputFileTracingIncludes: {
    "/**": ["./carrier-forms/*.pdf", "./drizzle/**/*"],
  },
};

export default nextConfig;
