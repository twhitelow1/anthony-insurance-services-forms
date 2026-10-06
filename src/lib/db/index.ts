import "server-only";
import type { NodePgDatabase } from "drizzle-orm/node-postgres";
import path from "node:path";
import * as schema from "./schema";
import { databaseUrl } from "./url";

/**
 * DATABASE_URL:
 *  - postgres://…        → Postgres (Neon via the Vercel Marketplace in production)
 *  - pglite:./.data/db   → embedded Postgres on disk, for local development
 *  - pglite:memory       → in-memory, for tests
 * Migrations run on first connection (and also before each Vercel build), so a
 * new database gets its tables even if the build couldn't reach it.
 */
export type Db = NodePgDatabase<typeof schema>;

const globalForDb = globalThis as unknown as { __aisDb?: Promise<Db> };

async function connect(): Promise<Db> {
  const found = databaseUrl();
  if (!found) throw new Error("No database configured: set DATABASE_URL (the Neon integration in Vercel adds it)");
  const { url } = found;
  // Scoped path, so the server bundle traces only the migrations folder.
  const migrationsFolder = path.join(process.cwd(), "drizzle");

  if (url.startsWith("pglite:")) {
    const { PGlite } = await import("@electric-sql/pglite");
    const { drizzle } = await import("drizzle-orm/pglite");
    const { migrate } = await import("drizzle-orm/pglite/migrator");
    const target = url.slice("pglite:".length);
    const client = new PGlite(target === "memory" ? undefined : target);
    const db = drizzle(client, { schema });
    await migrate(db, { migrationsFolder });
    return db as unknown as Db; // same query-builder API
  }

  const { Pool } = await import("pg");
  const { drizzle } = await import("drizzle-orm/node-postgres");
  const { migrate } = await import("drizzle-orm/node-postgres/migrator");
  const db = drizzle(new Pool({ connectionString: url, max: 5 }), { schema });
  // Already-applied migrations are skipped, so this is quick after the first time.
  await migrate(db, { migrationsFolder });
  return db;
}

export function getDb(): Promise<Db> {
  globalForDb.__aisDb ??= connect().catch((err) => {
    globalForDb.__aisDb = undefined;
    throw err;
  });
  return globalForDb.__aisDb;
}

export { schema };
