import { afterEach, describe, expect, it, vi } from "vitest";
import { sendViaResend } from "./resend";

afterEach(() => {
  vi.restoreAllMocks();
  vi.unstubAllEnvs();
});

describe("Resend sender", () => {
  it("falls back to the default sender when the configured one's domain isn't verified", async () => {
    vi.stubEnv("RESEND_API_KEY", "re_test");
    vi.stubEnv("MAIL_FROM", "todd@unverified.example");
    const froms: string[] = [];
    vi.spyOn(globalThis, "fetch").mockImplementation(async (_url, init) => {
      const from = JSON.parse(String(init?.body)).from as string;
      froms.push(from);
      return from.includes("unverified")
        ? new Response(JSON.stringify({ name: "validation_error", message: "The unverified.example domain is not verified." }), { status: 403 })
        : new Response(JSON.stringify({ id: "e1" }), { status: 200 });
    });
    await sendViaResend({ to: "a@example.com", subject: "Hi", html: "<p>Hi</p>" });
    expect(froms).toEqual(["todd@unverified.example", "Anthony Insurance Services <applications@anthonyinsuranceservices.com>"]);
  });

  it("doesn't retry other errors", async () => {
    vi.stubEnv("RESEND_API_KEY", "re_test");
    vi.stubEnv("MAIL_FROM", "apps@anthonyinsuranceservices.com");
    const spy = vi.spyOn(globalThis, "fetch").mockResolvedValue(new Response("rate limited", { status: 429 }));
    await expect(sendViaResend({ to: "a@example.com", subject: "Hi", html: "x" })).rejects.toThrow(/429/);
    expect(spy).toHaveBeenCalledTimes(1);
  });
});
