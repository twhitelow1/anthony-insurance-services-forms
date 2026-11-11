import "server-only";
import { createHash, randomBytes } from "node:crypto";
import { and, desc, eq, isNull } from "drizzle-orm";
import { getDb, schema } from "@/lib/db";
import type { ApiKey } from "@/lib/db/schema";

/**
 * Keys for the AIS Connect API and MCP connector. A key is "ais_live_" + 32 random characters; it's
 * shown once when made and only its SHA-256 hash is stored, so a database copy can't be used to call
 * the API. Sent as "Authorization: Bearer <key>".
 */

const PREFIX = "ais_live_";
const hash = (key: string) => createHash("sha256").update(key).digest("hex");

/** Make a key. Returns the key itself (show it once) and its record. */
export async function createApiKey(name: string, actor: string): Promise<{ key: string; record: ApiKey }> {
  const key = PREFIX + randomBytes(24).toString("base64url");
  const db = await getDb();
  const [record] = await db
    .insert(schema.apiKeys)
    .values({ name: name.trim().slice(0, 80) || "API key", prefix: key.slice(0, PREFIX.length + 4), keyHash: hash(key), createdBy: actor })
    .returning();
  return { key, record };
}

export async function listApiKeys() {
  const db = await getDb();
  return db
    .select({
      id: schema.apiKeys.id,
      name: schema.apiKeys.name,
      prefix: schema.apiKeys.prefix,
      createdBy: schema.apiKeys.createdBy,
      createdAt: schema.apiKeys.createdAt,
      lastUsedAt: schema.apiKeys.lastUsedAt,
      revokedAt: schema.apiKeys.revokedAt,
    })
    .from(schema.apiKeys)
    .orderBy(desc(schema.apiKeys.createdAt));
}

export async function revokeApiKey(id: string, actor: string) {
  const db = await getDb();
  await db
    .update(schema.apiKeys)
    .set({ revokedAt: new Date(), revokedBy: actor })
    .where(and(eq(schema.apiKeys.id, id), isNull(schema.apiKeys.revokedAt)));
}

/** The key's record when the request carries a live key ("Authorization: Bearer ais_live_…"), else null. */
export async function verifyApiKey(authorization: string | null): Promise<ApiKey | null> {
  const key = authorization?.match(/^Bearer\s+(\S+)$/i)?.[1];
  if (!key?.startsWith(PREFIX) || key.length > 200) return null;
  const db = await getDb();
  const [row] = await db
    .select()
    .from(schema.apiKeys)
    .where(and(eq(schema.apiKeys.keyHash, hash(key)), isNull(schema.apiKeys.revokedAt)))
    .limit(1);
  if (!row) return null;
  // Last used, at most once a minute per key.
  if (!row.lastUsedAt || Date.now() - row.lastUsedAt.getTime() > 60_000) {
    await db.update(schema.apiKeys).set({ lastUsedAt: new Date() }).where(eq(schema.apiKeys.id, row.id));
  }
  return row;
}

/** Who did it, in activity logs: "api:<key name>". */
export const apiActor = (key: Pick<ApiKey, "name">) => `api:${key.name}`;
