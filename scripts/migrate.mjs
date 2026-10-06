// Applies SQL migrations in ./drizzle to the Postgres database in DATABASE_URL.
// Runs before `next build` on Vercel; skipped when no Postgres URL is configured.
import pg from "pg";
import { drizzle } from "drizzle-orm/node-postgres";
import { migrate } from "drizzle-orm/node-postgres/migrator";

// Same lookup as src/lib/db/url.ts: DATABASE_URL, POSTGRES_URL, or a prefixed *_DATABASE_URL.
const env = process.env;
const name =
  ["DATABASE_URL", "POSTGRES_URL"].find((k) => env[k]) ??
  Object.keys(env)
    .filter((k) => /(_DATABASE_URL|_POSTGRES_URL)$/.test(k) && !/UNPOOLED|NON_POOLING/.test(k) && env[k])
    .sort()[0];
const url = name && env[name];
if (!url || !/^postgres(ql)?:\/\//.test(url)) {
  console.log("[migrate] No Postgres URL found — skipping (the app will migrate on first connection).");
  process.exit(0);
}
console.log(`[migrate] using ${name}`);
const pool = new pg.Pool({ connectionString: url, max: 1 });
await migrate(drizzle(pool), { migrationsFolder: "./drizzle" });
await pool.end();
console.log("[migrate] done");
