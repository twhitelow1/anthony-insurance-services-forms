import { describe, expect, it, vi } from "vitest";
import { sportsFacilityApplication as form } from "@/forms/sports-facility-application";
import { createApplication } from "@/lib/applications/repo";
import { pruneValues } from "@/lib/forms/validate";
import { askAssistant } from "./assistant";
import { AiRefusalError, type AiClient } from "./client";
import { reviewApplication } from "./review";

type Msg = { content: unknown[]; stop_reason: string; model?: string };

/** A stand-in for the Anthropic client that replays scripted responses and records requests. */
function fakeClient(responses: Msg[]) {
  const calls: Record<string, unknown>[] = [];
  const create = vi.fn(async (params: Record<string, unknown>) => {
    calls.push(structuredClone(params));
    const r = responses.shift();
    if (!r) throw new Error("no more scripted responses");
    return { model: "claude-opus-5-5", ...r };
  });
  return { client: { beta: { messages: { create } } } as unknown as AiClient, calls };
}

const values = pruneValues(form, {
  first_name: "Jane",
  last_name: "Doe",
  email: "jane@example.com",
  legal_business_name: "Bounce Kids LLC",
  mailing_state: "TX",
  has_trampolines: "Yes",
  trampoline_count: "6",
  trampoline_above_ground: "Yes",
  sexual_abuse_incident: "No",
});

describe("reviewApplication", () => {
  it("sends the answers with a JSON schema and fallback, sorts flags by severity", async () => {
    const review = {
      summary: "Trampoline park in Texas.",
      flags: [
        { severity: "low", title: "Minor", detail: "x" },
        { severity: "high", title: "Above-ground trampoline", detail: "Answered Yes." },
      ],
      missingInfo: ["Pool count"],
      followUpQuestions: ["How tall is the trampoline?"],
    };
    const { client, calls } = fakeClient([{ stop_reason: "end_turn", content: [{ type: "text", text: JSON.stringify(review) }] }]);
    const out = await reviewApplication(client, form, values, { reference: "AIS-AAAA-BBBB" });

    expect(out.flags.map((f) => f.severity)).toEqual(["high", "low"]);
    expect(out.model).toBe("claude-opus-5-5");
    const req = calls[0] as { fallbacks: string; betas: string[]; output_config: { format: { type: string } }; messages: { content: string }[] };
    expect(req.fallbacks).toBe("default");
    expect(req.betas).toContain("server-side-fallback-2026-07-01");
    expect(req.output_config.format.type).toBe("json_schema");
    expect(req.messages[0].content).toContain("Bounce Kids LLC");
    expect(req.messages[0].content).toContain("AIS-AAAA-BBBB");
  });

  it("surfaces a refusal instead of parsing empty output", async () => {
    const { client } = fakeClient([{ stop_reason: "refusal", content: [] }]);
    await expect(reviewApplication(client, form, values, { reference: "AIS-AAAA-BBBB" })).rejects.toBeInstanceOf(AiRefusalError);
  });
});

describe("askAssistant", () => {
  it("runs read-only tools against the database and links what it saw", async () => {
    const app = await createApplication(form, values, {});
    const { client, calls } = fakeClient([
      {
        stop_reason: "tool_use",
        content: [
          { type: "thinking", thinking: "", signature: "sig" },
          { type: "tool_use", id: "t1", name: "search_applications", input: { query: "trampoline", status: null, state: "TX", limit: 5 } },
        ],
      },
      {
        stop_reason: "tool_use",
        content: [{ type: "tool_use", id: "t2", name: "get_application", input: { reference: app.reference } }],
      },
      { stop_reason: "end_turn", content: [{ type: "text", text: `- ${app.reference}: Bounce Kids LLC has above-ground trampolines.` }] },
    ]);

    const res = await askAssistant(client, [{ role: "user", content: "Who has trampolines in Texas?" }]);

    expect(res.reply).toContain(app.reference);
    expect(res.seen).toContainEqual({ reference: app.reference, id: app.id, businessName: "Bounce Kids LLC" });

    // Search results went back as a tool_result, and the assistant turn was replayed unchanged.
    const second = calls[1] as { messages: { role: string; content: { type: string; content?: string }[] }[] };
    expect(second.messages[1].content[0].type).toBe("thinking");
    expect(second.messages[2].content[0].content).toContain(app.reference);
    // get_application returned the full answers.
    const third = calls[2] as typeof second;
    expect(third.messages[4].content[0].content).toContain("Do you have an above-ground trampoline");
  });

  it("stops after too many tool rounds", async () => {
    const loop = Array.from({ length: 8 }, (_, i) => ({
      stop_reason: "tool_use",
      content: [{ type: "tool_use", id: `t${i}`, name: "search_applications", input: { query: "x", status: null, state: null, limit: 1 } }],
    }));
    const { client } = fakeClient(loop);
    const res = await askAssistant(client, [{ role: "user", content: "loop" }]);
    expect(res.reply).toMatch(/narrower question/);
  });
});
