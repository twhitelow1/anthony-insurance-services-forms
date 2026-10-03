import "server-only";
import type { NodePgDatabase } from "drizzle-orm/node-postgres";
import * as schema from "./schema";

/**
 * DATABASE_URL:
 *  - postgres://…        → Postgres (Neon via the Vercel Marketplace in production)
 *  - pglite:./.data/db   → embedded Postgres on disk, for local development
 *  - pglite:memory       → in-memory, for tests
 * Migrations for pglite run automatically; for Postgres run `npm run db:migrate`.
 */
export type Db = NodePgDatabase<typeof schema>;

const globalForDb = globalThis as unknown as { __aisDb?: Promise<Db> };

async function connect(): Promise<Db> {
  const url = process.env.DATABASE_URL;
  if (!url) throw new Error("DATABASE_URL is not set");

  if (url.startsWith("pglite:")) {
    const { PGlite } = await import("@electric-sql/pglite");
    const { drizzle } = await import("drizzle-orm/pglite");
    const { migrate } = await import("drizzle-orm/pglite/migrator");
    const target = url.slice("pglite:".length);
    const client = new PGlite(target === "memory" ? undefined : target);
    const db = drizzle(client, { schema });
    await migrate(db, { migrationsFolder: "./drizzle" });
    return db as unknown as Db; // same query-builder API
  }

  const { Pool } = await import("pg");
  const { drizzle } = await import("drizzle-orm/node-postgres");
  return drizzle(new Pool({ connectionString: url, max: 5 }), { schema });
}

export function getDb(): Promise<Db> {
  globalForDb.__aisDb ??= connect().catch((err) => {
    globalForDb.__aisDb = undefined;
    throw err;
  });
  return globalForDb.__aisDb;
}

export { schema };
