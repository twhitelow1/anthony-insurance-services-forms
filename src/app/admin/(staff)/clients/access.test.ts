import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { NextRequest } from "next/server";
import { sign } from "@/lib/auth/session";
import { ensureClient, listAccountContacts } from "@/lib/clients/repo";
import { CLIENT_SEARCH_COOKIE } from "@/lib/clients/search-cookie";

// A cookie jar standing in for the browser, so the real session checks run.
const jar = new Map<string, string>();
vi.mock("next/headers", () => ({
  cookies: async () => ({
    get: (name: string) => (jar.has(name) ? { name, value: jar.get(name)! } : undefined),
    set: (name: string, value: string) => jar.set(name, value),
    delete: (name: string | { name: string }) => jar.delete(typeof name === "string" ? name : name.name),
  }),
  headers: async () => new Headers(),
}));

const signIn = async (role: "staff" | "client", email: string) =>
  jar.set("ais_session", await sign(role === "staff" ? { role, email, name: "Amy" } : { role, email }, 3600, "ais:session"));

beforeEach(() => jar.clear());
afterEach(() => vi.unstubAllEnvs());

describe("admin-only access", () => {
  it("the accounts CSV export needs a staff session", async () => {
    const { GET } = await import("./export/route");
    const req = () => new NextRequest("https://forms.example.com/admin/clients/export?sort=name");
    expect((await GET(req())).status).toBe(401);
    await signIn("client", "someone@example.com");
    expect((await GET(req())).status).toBe(401);

    const email = `csv.${Math.random().toString(36).slice(2, 8)}@example.com`;
    await ensureClient({ email, businessName: "CSV Studio", phone: "(555) 444-3333" });
    await signIn("staff", "amy@anthonyinsuranceservices.com");
    jar.set(CLIENT_SEARCH_COOKIE, "555-444-3333"); // the search applies to the export
    const res = await GET(req());
    expect(res.status).toBe(200);
    expect(res.headers.get("content-type")).toContain("text/csv");
    const csv = await res.text();
    expect(csv.split("\r\n")[0]).toContain("Account,Type,Primary contact,Email,Phone");
    expect(csv).toContain(`CSV Studio,Business,${email},${email},(555) 444-3333`);
    expect(csv.trim().split("\r\n")).toHaveLength(2);
  });

  it("mapping actions refuse anyone who isn't staff", async () => {
    const { startScanAction, confirmAction, saveDecisionsAction } = await import("@/app/admin/(staff)/settings/mapping/actions");
    const { getRun } = await import("@/lib/mapping/runs");
    const fd = new FormData();
    fd.set("kind", "lead-alchemist-companies");
    fd.set("reviewed", "yes");
    await signIn("client", "someone@example.com");
    for (const action of [startScanAction, confirmAction, saveDecisionsAction]) await expect(action(fd)).rejects.toThrow(/NEXT_REDIRECT/);
    expect(await getRun("la_companies")).toBeNull();
  });

  it("the retry cron needs the secret", async () => {
    const { GET } = await import("@/app/api/cron/sync/route");
    expect((await GET(new Request("https://forms.example.com/api/cron/sync"))).status).toBe(401);
    vi.stubEnv("CRON_SECRET", "a-long-enough-cron-secret-value");
    const ok = await GET(new Request("https://forms.example.com/api/cron/sync", { headers: { authorization: "Bearer a-long-enough-cron-secret-value" } }));
    expect(ok.status).toBe(200);
  });

  it("account actions refuse anyone who isn't staff", async () => {
    const { mergeClientAction, splitContactAction } = await import("./actions");
    const a = await ensureClient({ email: `act-a.${Math.random().toString(36).slice(2, 8)}@example.com` });
    const b = await ensureClient({ email: `act-b.${Math.random().toString(36).slice(2, 8)}@example.com` });
    const fd = new FormData();
    fd.set("id", a);
    fd.set("other", b);
    await signIn("client", "someone@example.com");
    await expect(mergeClientAction(fd)).rejects.toThrow(/NEXT_REDIRECT/);
    await expect(splitContactAction(fd)).rejects.toThrow(/NEXT_REDIRECT/);
    expect(await listAccountContacts(a)).toHaveLength(1); // nothing merged
  });
});

describe("integration keys", () => {
  it("only staff can save connection keys", async () => {
    const { saveIntegrationAction } = await import("../settings/integrations/actions");
    const form = new FormData();
    form.set("integration", "lead_alchemist");
    form.set("laLocationId", "Loc123");
    await signIn("client", "someone@example.com");
    await expect(saveIntegrationAction(form)).rejects.toThrow();
    const { credentials, clearCredentialCache } = await import("@/lib/integrations/credentials");
    clearCredentialCache();
    expect((await credentials()).laLocationId).not.toBe("Loc123");
  });
});
