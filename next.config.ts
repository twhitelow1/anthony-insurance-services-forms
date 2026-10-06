import type { NextConfig } from "next";

const nextConfig: NextConfig = {
  // PGlite (embedded Postgres for local dev/tests) ships WASM; load it from node_modules as-is.
  serverExternalPackages: ["@electric-sql/pglite"],
  // Carrier PDF templates are read from disk at runtime; ship them with the server functions.
  outputFileTracingIncludes: {
    "/**": ["./carrier-forms/*.pdf"],
  },
};

export default nextConfig;
