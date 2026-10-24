/**
 * Lead Alchemist settings in Vercel use the `LA_` prefix (e.g. `LA_API_TOKEN`).
 * The older `GHL_` names still work, so nothing breaks before they're renamed in Vercel.
 */
export function laEnv(name: string, env: Record<string, string | undefined> = process.env): string | undefined {
  return env[`LA_${name}`] ?? env[`GHL_${name}`];
}

/** Where staff open Lead Alchemist: the white-label address, never the underlying platform's. */
export const LA_DEFAULT_APP_URL = "https://app.leadalchemist.io";

export function laAppUrl(env: Record<string, string | undefined> = process.env) {
  return (laEnv("APP_URL", env)?.trim() || LA_DEFAULT_APP_URL).replace(/\/$/, "");
}
