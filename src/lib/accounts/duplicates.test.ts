import { describe, expect, it } from "vitest";
import { eq } from "drizzle-orm";
import { getDb, schema } from "@/lib/db";
import { ensureClient } from "@/lib/clients/repo";

const uniq = () => Math.random().toString(36).slice(2, 8);

describe("duplicate AIS Connect accounts", () => {
  it("groups accounts by name, email, phone and website, says why, and leaves out pairs marked different", async () => {
    const { findDuplicateGroups } = await import("./duplicates");
    const { markNotDuplicates } = await import("./merge");
    const tag = uniq();
    const db = await getDb();
    // Same business three ways: name (punctuation and LLC aside), and a phone shared with a third account.
    const a = await ensureClient({ email: `a.${tag}@gmail.com`, contactName: `Al ${tag}`, businessName: `Dupe Gym ${tag}` });
    const b = await ensureClient({ email: `b.${tag}@gmail.com`, contactName: `Bo ${tag}`, businessName: `Dupe Gym, ${tag} LLC` });
    const c = await ensureClient({ email: `c.${tag}@gmail.com`, contactName: `Cy ${tag}`, businessName: `Other Name ${tag}` });
    const phone = `(512) 555-${String(Math.floor(Math.random() * 9000) + 1000)}`;
    await db.update(schema.clients).set({ phones: [phone] }).where(eq(schema.clients.id, b));
    await db.update(schema.clients).set({ phones: [phone] }).where(eq(schema.clients.id, c));
    // Same website, written differently.
    const d = await ensureClient({ email: `d.${tag}@gmail.com`, contactName: `Di ${tag}`, businessName: `Site One ${tag}` });
    const e = await ensureClient({ email: `e.${tag}@gmail.com`, contactName: `Ed ${tag}`, businessName: `Site Two ${tag}` });
    await db.update(schema.clients).set({ website: `https://www.site-${tag}.com/about` }).where(eq(schema.clients.id, d));
    await db.update(schema.clients).set({ website: `site-${tag}.com` }).where(eq(schema.clients.id, e));

    const mine = async () => (await findDuplicateGroups({ q: tag })).map((g) => ({ ids: g.accounts.map((x) => x.id).sort(), reasons: g.reasons }));
    const groups = await mine();
    expect(groups).toContainEqual({ ids: [a, b, c].sort(), reasons: ["same name", "same phone", "flagged when created"] }); // the second Dupe Gym was flagged on intake
    expect(groups).toContainEqual({ ids: [d, e].sort(), reasons: ["same website"] });
    expect((await findDuplicateGroups({ q: tag, reason: "same website" })).map((g) => g.accounts.length)).toEqual([2]);

    // "Not the same business" for the website pair: that group goes away.
    await markNotDuplicates([`a:${d}`, `a:${e}`], "staff:amy@x.com");
    expect((await mine()).some((g) => g.ids.includes(d))).toBe(false);
  });
});
