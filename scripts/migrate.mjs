// Applies SQL migrations in ./drizzle to the Postgres database in DATABASE_URL.
// Runs before `next build` on Vercel; skipped when no Postgres URL is configured.
import pg from "pg";
import { drizzle } from "drizzle-orm/node-postgres";
import { migrate } from "drizzle-orm/node-postgres/migrator";

const url = process.env.DATABASE_URL;
if (!url || !/^postgres(ql)?:\/\//.test(url)) {
  console.log("[migrate] DATABASE_URL is not a Postgres URL — skipping.");
  process.exit(0);
}
const pool = new pg.Pool({ connectionString: url, max: 1 });
await migrate(drizzle(pool), { migrationsFolder: "./drizzle" });
await pool.end();
console.log("[migrate] done");
