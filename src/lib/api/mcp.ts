import "server-only";
import { ApiError } from "./service";
import { TOOLS } from "./tools";

/**
 * A minimal MCP server (Model Context Protocol, Streamable HTTP transport, stateless): JSON-RPC
 * messages in, JSON responses out. Supports initialize, ping, tools/list and tools/call.
 */

const SUPPORTED = ["2025-06-18", "2025-03-26", "2024-11-05"];
const SERVER_INFO = { name: "ais-connect", title: "AIS Connect", version: "1.0.0" };
const INSTRUCTIONS =
  "AIS Connect holds Anthony Insurance's online applications. Use list_forms and describe_form to learn a form's questions, then start_application to send an applicant a pre-filled application to check and sign (it's never submitted for them). Use find_applications and get_application for status, and set_application_status or add_application_note to update one.";

type Id = string | number | null;
interface Rpc {
  jsonrpc?: string;
  id?: Id;
  method?: string;
  params?: Record<string, unknown>;
}

const ok = (id: Id, result: unknown) => ({ jsonrpc: "2.0", id, result });
const fail = (id: Id, code: number, message: string) => ({ jsonrpc: "2.0", id, error: { code, message } });

async function handle(msg: Rpc, actor: string) {
  const id = msg.id ?? null;
  const isNotification = msg.id === undefined;
  if (msg.jsonrpc !== "2.0" || typeof msg.method !== "string") return isNotification ? null : fail(id, -32600, "Invalid request");
  if (isNotification) return null; // notifications/initialized and friends: nothing to answer

  switch (msg.method) {
    case "initialize": {
      const asked = String(msg.params?.protocolVersion ?? "");
      return ok(id, {
        protocolVersion: SUPPORTED.includes(asked) ? asked : SUPPORTED[0],
        capabilities: { tools: { listChanged: false } },
        serverInfo: SERVER_INFO,
        instructions: INSTRUCTIONS,
      });
    }
    case "ping":
      return ok(id, {});
    case "tools/list":
      return ok(id, {
        tools: TOOLS.map((t) => ({
          name: t.name,
          description: t.description,
          inputSchema: t.inputSchema,
          annotations: { readOnlyHint: t.readOnly, destructiveHint: false, openWorldHint: false },
        })),
      });
    case "tools/call": {
      const tool = TOOLS.find((t) => t.name === msg.params?.name);
      if (!tool) return fail(id, -32602, `Unknown tool: ${String(msg.params?.name)}`);
      const args = (msg.params?.arguments ?? {}) as Record<string, unknown>;
      try {
        const result = await tool.run(args && typeof args === "object" ? args : {}, actor);
        return ok(id, { content: [{ type: "text", text: JSON.stringify(result, null, 2) }], structuredContent: result, isError: false });
      } catch (err) {
        // Tool problems go back to the assistant as a result it can read and act on.
        const message = err instanceof ApiError ? err.message : "Something went wrong in AIS Connect. Try again, or ask staff to check.";
        if (!(err instanceof ApiError)) console.error(`[mcp] ${tool.name} failed`, err);
        return ok(id, { content: [{ type: "text", text: message }], isError: true });
      }
    }
    default:
      return fail(id, -32601, `Method not found: ${msg.method}`);
  }
}

/** Answer one JSON-RPC message or a batch. Returns null when there's nothing to send back (only notifications). */
export async function handleMcp(body: unknown, actor: string): Promise<unknown | null> {
  if (Array.isArray(body)) {
    const replies = (await Promise.all(body.map((m) => handle(m as Rpc, actor)))).filter(Boolean);
    return replies.length ? replies : null;
  }
  if (!body || typeof body !== "object") return fail(null, -32700, "Parse error");
  return handle(body as Rpc, actor);
}
