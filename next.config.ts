import type { NextConfig } from "next";

const nextConfig: NextConfig = {
  // PGlite (embedded Postgres for local dev/tests) ships WASM; load it from node_modules as-is.
  serverExternalPackages: ["@electric-sql/pglite"],
};

export default nextConfig;
