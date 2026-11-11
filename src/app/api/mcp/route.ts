import type { NextRequest } from "next/server";
import { apiActor, verifyApiKey } from "@/lib/api/keys";
import { handleMcp } from "@/lib/api/mcp";

/**
 * AIS Connect MCP server (Streamable HTTP, stateless) for AI assistants such as Lead Alchemist's Ask AI.
 * Authorization: Bearer <AIS Connect API key> (Settings → Integrations).
 */
export async function POST(req: NextRequest) {
  const key = await verifyApiKey(req.headers.get("authorization"));
  if (!key) {
    return Response.json(
      { jsonrpc: "2.0", id: null, error: { code: -32001, message: "Send a live AIS Connect API key as 'Authorization: Bearer ais_live_…'." } },
      { status: 401, headers: { "WWW-Authenticate": 'Bearer realm="AIS Connect"' } },
    );
  }
  const raw = await req.text();
  if (raw.length > 300_000) return Response.json({ jsonrpc: "2.0", id: null, error: { code: -32600, message: "Request too large" } }, { status: 413 });
  let body: unknown;
  try {
    body = JSON.parse(raw);
  } catch {
    return Response.json({ jsonrpc: "2.0", id: null, error: { code: -32700, message: "Parse error" } }, { status: 400 });
  }
  const reply = await handleMcp(body, apiActor(key));
  if (reply === null) return new Response(null, { status: 202 });
  return Response.json(reply, { headers: { "Cache-Control": "no-store" } });
}

/** No server-to-client stream: this server only answers requests. */
export function GET() {
  return new Response("Method Not Allowed", { status: 405, headers: { Allow: "POST" } });
}

/** Stateless: there's no session to end. */
export function DELETE() {
  return new Response(null, { status: 405, headers: { Allow: "POST" } });
}
