import "server-only";
import type { NextRequest } from "next/server";
import { apiActor, verifyApiKey } from "./keys";
import { ApiError } from "./service";

const MAX_BODY_BYTES = 300_000;
const headers = { "Cache-Control": "no-store" };

/** Run an API request as the key in its Authorization header: 401 without a live key, ApiErrors as JSON. */
export async function withApiKey(req: NextRequest, run: (actor: string, body: Record<string, unknown>) => Promise<unknown>) {
  const key = await verifyApiKey(req.headers.get("authorization"));
  if (!key) return Response.json({ error: "Send a live AIS Connect API key as 'Authorization: Bearer ais_live_…' (Settings → Integrations)." }, { status: 401, headers });
  let body: Record<string, unknown> = {};
  if (req.method !== "GET") {
    const raw = await req.text();
    if (raw.length > MAX_BODY_BYTES) return Response.json({ error: "Request too large" }, { status: 413, headers });
    try {
      body = raw ? JSON.parse(raw) : {};
    } catch {
      return Response.json({ error: "Invalid JSON" }, { status: 400, headers });
    }
  }
  try {
    return Response.json(await run(apiActor(key), body), { headers });
  } catch (err) {
    if (err instanceof ApiError) return Response.json({ error: err.message }, { status: err.status, headers });
    console.error("[api] request failed", err);
    return Response.json({ error: "Something went wrong in AIS Connect." }, { status: 500, headers });
  }
}
