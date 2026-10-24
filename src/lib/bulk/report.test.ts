import { describe, expect, it } from "vitest";
import { getDb, schema } from "@/lib/db";
import { eq } from "drizzle-orm";
import { getSyncReport, saveSyncReport, sortNotes, summarize } from "./report";

describe("sync reports", () => {
  it("sorts the sync messages into errors, conflicts and skipped rows", () => {
    const s = sortNotes([
      "Ann Studio: Salesforce isn't connected. Add the keys in Settings → Integrations.",
      "001ABC failed: REQUEST_LIMIT_EXCEEDED",
      "Bo Gym: 2 Lead Alchemist Companies have this name; pick one on the account's mapping row.",
      '"Cy Corp" is already linked to Cy Inc.',
      "3 weren't reached in this run (time limit per click): click again to do the rest.",
      "2 skipped: not in AIS Connect yet (add it first).",
      "4 already matched Lead Alchemist.",
      "",
    ]);
    expect(s.errors).toHaveLength(2);
    expect(s.conflicts).toHaveLength(2);
    expect(s.skipped).toHaveLength(2);
    expect(s.notes).toEqual(["4 already matched Lead Alchemist."]);
  });

  it("says plainly when everything synced, and counts problems when not", () => {
    const empty = { errors: [], conflicts: [], skipped: [], notes: [] };
    expect(summarize({ title: "Synced to Lead Alchemist", total: 25, done: 25, ...empty })).toEqual({ text: "Synced to Lead Alchemist: all 25 done, no conflicts or errors.", clean: true });
    const r = summarize({ title: "Synced", total: 25, done: 22, ...empty, conflicts: ["a", "b"], errors: ["c"] });
    expect(r).toEqual({ text: "Synced: 22 of 25 done · 2 conflicts · 1 error.", clean: false });
    // Done but with a conflict note is still not clean.
    expect(summarize({ title: "S", total: 1, done: 1, ...empty, conflicts: ["x"] }).clean).toBe(false);
  });

  it("saves the report, and raises a Notifications card only when something needs attention", async () => {
    const db = await getDb();
    const ok = await saveSyncReport({ title: "Added", scope: "2 ticked on Contacts", actor: "staff:amy@x.com", total: 2, done: 2, notes: [] });
    expect(ok.clean).toBe(true);
    expect(await db.select().from(schema.notifications).where(eq(schema.notifications.title, "Sync needs attention: Added"))).toHaveLength(0);

    const bad = await saveSyncReport({ title: "Linked in Salesforce", scope: "3 ticked", actor: "staff:amy@x.com", total: 3, done: 1, notes: ["X failed: boom", "Y: 2 Salesforce Accounts have this name; sync the right one."] });
    expect(bad.clean).toBe(false);
    expect(bad.href).toBe(`/admin/sync-reports/${bad.report.id}`);
    expect(await getSyncReport(bad.report.id)).toMatchObject({ done: 1, total: 3, errors: ["X failed: boom"], conflicts: [expect.stringContaining("have this name")] });
    const [card] = await db.select().from(schema.notifications).where(eq(schema.notifications.title, "Sync needs attention: Linked in Salesforce"));
    expect(card).toMatchObject({ kind: "sync_issues" });
  });
});
