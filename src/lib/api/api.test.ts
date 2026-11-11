import { describe, expect, it, vi } from "vitest";
import { NextRequest } from "next/server";

const sent = vi.hoisted(() => [] as { to: string; subject: string; text?: string }[]);
vi.mock("@/lib/mail", async (orig) => ({
  ...(await orig<typeof import("@/lib/mail")>()),
  sendMail: async (m: { to: string; subject: string; text?: string }) => void sent.push(m),
}));
// Work done after the response (Lead Alchemist syncs, status emails) isn't part of these tests.
vi.mock("next/server", async (orig) => ({ ...(await orig<typeof import("next/server")>()), after: () => {} }));

import { createApiKey, revokeApiKey, verifyApiKey } from "./keys";
import { handleMcp } from "./mcp";
import { createApplication, getApplication, getEvents } from "@/lib/applications/repo";
import { larpEventApplication as larp } from "@/forms/larp-event-application";
import { POST as mcpRoute } from "@/app/api/mcp/route";
import { POST as searchRoute } from "@/app/api/v1/applications/search/route";

const rpc = (method: string, params?: Record<string, unknown>) => ({ jsonrpc: "2.0", id: 1, method, params });
type Reply = { result?: { content?: { text: string }[]; structuredContent?: Record<string, unknown>; isError?: boolean; tools?: { name: string }[]; protocolVersion?: string }; error?: { code: number } };
const call = async (name: string, args: Record<string, unknown>) => (await handleMcp(rpc("tools/call", { name, arguments: args }), "api:test")) as Reply;

describe("API keys", () => {
  it("only accept a live key, by its hash, and stop working once revoked", async () => {
    const { key, record } = await createApiKey("Ask AI", "staff:t");
    expect(key).toMatch(/^ais_live_[A-Za-z0-9_-]{32}$/);
    expect(record.keyHash).not.toContain(key.slice(9));
    expect((await verifyApiKey(`Bearer ${key}`))?.id).toBe(record.id);
    expect(await verifyApiKey(`Bearer ${key}x`)).toBeNull();
    expect(await verifyApiKey(null)).toBeNull();
    await revokeApiKey(record.id, "staff:t");
    expect(await verifyApiKey(`Bearer ${key}`)).toBeNull();
  });

  it("the endpoints refuse requests without one", async () => {
    const res = await mcpRoute(new NextRequest("https://x/api/mcp", { method: "POST", body: JSON.stringify(rpc("tools/list")) }));
    expect(res.status).toBe(401);
    const rest = await searchRoute(new NextRequest("https://x/api/v1/applications/search", { method: "POST", body: "{}", headers: { authorization: "Bearer ais_live_nope" } }));
    expect(rest.status).toBe(401);
  });
});

describe("MCP connector", () => {
  it("handshakes and lists its tools", async () => {
    const init = (await handleMcp(rpc("initialize", { protocolVersion: "2025-06-18", capabilities: {}, clientInfo: { name: "t", version: "1" } }), "api:test")) as Reply;
    expect(init.result?.protocolVersion).toBe("2025-06-18");
    expect(await handleMcp({ jsonrpc: "2.0", method: "notifications/initialized" }, "api:test")).toBeNull();
    const list = (await handleMcp(rpc("tools/list"), "api:test")) as Reply;
    expect(list.result?.tools?.map((t) => t.name)).toEqual([
      "list_forms",
      "describe_form",
      "start_application",
      "find_applications",
      "get_application",
      "set_application_status",
      "add_application_note",
    ]);
    expect(((await handleMcp(rpc("nope"), "api:test")) as Reply).error?.code).toBe(-32601);
  });

  it("describes a form's questions", async () => {
    const r = await call("describe_form", { form: "larp-event-application" });
    const sections = r.result?.structuredContent?.sections as { title: string; questions: { id: string; required?: boolean; options?: unknown[] }[] }[];
    const gl = sections.find((s) => s.title === "General Liability Coverage")!.questions.find((q) => q.id === "gl_aggregate")!;
    expect(gl).toMatchObject({ required: true, options: ["$1,000,000", "$2,000,000", "$3,000,000", "$4,000,000", "$5,000,000"] });
    expect(JSON.stringify(sections)).not.toContain('"signature"');
    expect((await call("describe_form", { form: "nope" })).result?.isError).toBe(true);
  });

  it("starts an application and emails the applicant the link to finish and sign; never submits it", async () => {
    sent.length = 0;
    const email = `ask-ai-${Date.now()}@example.com`;
    const r = await call("start_application", {
      form: "larp-event-application",
      answers: { email, first_name: "Robin", last_name: "Hood", legal_business_name: "Sherwood LARP", gl_aggregate: "$2,000,000", insurer_renewing: "Yes: they're renewing it", signature: "data:image/png;base64,fake" },
    });
    const out = r.result?.structuredContent as { applicantLink: string; emailedTo: string; stillNeeded: { question: string }[]; draftId: string };
    expect(r.result?.isError).toBe(false);
    expect(out.emailedTo).toBe(email);
    expect(out.applicantLink).toContain("/forms/larp-event-application?resume=");
    expect(out.stillNeeded.map((q) => q.question)).toContain("phone");
    expect(out.stillNeeded.map((q) => q.question)).not.toContain("gl_aggregate");
    expect(sent.at(-1)?.to).toBe(email);
    const { getDraftById } = await import("@/lib/applications/drafts");
    const draft = (await getDraftById(out.draftId))!;
    expect(draft.values).toMatchObject({ gl_aggregate: "$2,000,000", insurer_renewing: "Yes" }); // labels become the stored values
    expect(draft.values.signature).toBeUndefined();
    expect(draft.status).toBe("started");
    // No email, no start.
    expect((await call("start_application", { form: "larp-event-application", answers: { first_name: "X" } })).result?.isError).toBe(true);
  });

  it("finds an application, shows it, changes its status and adds a note, logged as the key", async () => {
    const email = `status-${Date.now()}@example.com`;
    const app = await createApplication(larp, { email, first_name: "Maid", last_name: "Marian", legal_business_name: "Nottingham Guild" }, {});
    const found = (await call("find_applications", { email })).result?.structuredContent as { applications: { reference: string }[] };
    expect(found.applications.map((a) => a.reference)).toEqual([app.reference]);
    const byRef = (await call("get_application", { application: app.reference })).result?.structuredContent as { status: string; answers: unknown[] };
    expect(byRef.status).toBe("received");
    expect(byRef.answers.length).toBeGreaterThan(0);

    const changed = await call("set_application_status", { application: app.reference, status: "in_review", note: "Checking with the carrier" });
    expect(changed.result?.structuredContent).toMatchObject({ status: "in_review", previousStatus: "received", applicantNotified: false });
    expect((await call("set_application_status", { application: app.id, status: "bogus" })).result?.isError).toBe(true);
    await call("add_application_note", { application: app.id, note: "Venue certificate requested" });

    expect((await getApplication(app.id))!.status).toBe("in_review");
    const events = await getEvents(app.id);
    expect(events.find((e) => e.type === "staff_note")).toMatchObject({ actor: "api:test", message: "Venue certificate requested", clientVisible: false });
    expect(events.find((e) => e.type === "status_changed")?.actor).toBe("api:test");
  });

  it("works over HTTP with a live key", async () => {
    const { key } = await createApiKey("HTTP test", "staff:t");
    const res = await mcpRoute(new NextRequest("https://x/api/mcp", { method: "POST", body: JSON.stringify(rpc("tools/call", { name: "list_forms", arguments: {} })), headers: { authorization: `Bearer ${key}` } }));
    expect(res.status).toBe(200);
    const body = (await res.json()) as Reply;
    expect((body.result?.structuredContent?.forms as { form: string }[]).some((f) => f.form === "larp-event-application")).toBe(true);
  });
});
