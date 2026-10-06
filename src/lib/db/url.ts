/**
 * Find the Postgres connection string. Neon's Vercel integration may name it
 * DATABASE_URL, POSTGRES_URL, or add a custom prefix (e.g. NEON_DATABASE_URL),
 * so accept any of those. Pooled URLs are preferred over *_UNPOOLED ones.
 */
export function databaseUrl(env: Record<string, string | undefined> = process.env): { url: string; name: string } | null {
  for (const name of ["DATABASE_URL", "POSTGRES_URL"]) {
    if (env[name]) return { url: env[name]!, name };
  }
  const candidates = Object.keys(env)
    .filter((k) => /(_DATABASE_URL|_POSTGRES_URL)$/.test(k) && !/UNPOOLED|NON_POOLING/.test(k) && env[k])
    .sort();
  return candidates.length ? { url: env[candidates[0]]!, name: candidates[0] } : null;
}

/**
 * A readable one-line reason for a database error, with any connection string
 * removed. Drizzle wraps driver errors ("Failed query: …"), so include the cause.
 */
export function describeDbError(err: unknown): string {
  const parts: string[] = [];
  for (let e: unknown = err, depth = 0; e && depth < 3; e = (e as { cause?: unknown }).cause, depth++) {
    const msg = e instanceof Error ? e.message : String(e);
    const code = (e as { code?: string }).code;
    parts.push(code && !msg.includes(code) ? `${msg} (${code})` : msg);
  }
  return parts
    .map((p) => p.split("\n")[0])
    .join(" — ")
    .replace(/postgres(ql)?:\/\/\S+/gi, "postgres://…")
    .slice(0, 300);
}
