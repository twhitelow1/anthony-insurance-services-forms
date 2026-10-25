import { describe, expect, it } from "vitest";
import { getDb, schema } from "@/lib/db";
import { eq } from "drizzle-orm";
import { getSyncReport, saveSyncReport, sortNotes, summarize } from "./report";
import { describeTally, emptyTally } from "./tally";

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
    expect(r).toEqual({ text: "Needs attention: Synced: 22 of 25 done · 2 conflicts · 1 error.", clean: false });
    // Done but with a conflict note is still not clean.
    expect(summarize({ title: "S", total: 1, done: 1, ...empty, conflicts: ["x"] }).clean).toBe(false);
    // A skipped row is never "all done" either.
    expect(summarize({ title: "S", total: 1, done: 1, ...empty, skipped: ["x"] }).clean).toBe(false);
  });

  it("counts what happened to each contact in a Lead Alchemist sync, and any skipped contact needs attention", () => {
    const empty = { errors: [], conflicts: [], skipped: [], notes: [] };
    const contacts = { ...emptyTally(), linked: 3, created: 2 };
    expect(summarize({ title: "Synced to Lead Alchemist", total: 2, done: 2, ...empty, contacts })).toEqual({
      text: "Synced to Lead Alchemist: all 2 done, no conflicts or errors. Contacts: 3 linked, 2 created.",
      clean: true,
    });
    const r = summarize({ title: "Synced to Lead Alchemist", total: 2, done: 2, ...empty, contacts: { ...contacts, noEmailOrPhone: 1, failed: 1 } });
    expect(r.clean).toBe(false);
    expect(r.text).toBe("Needs attention: Synced to Lead Alchemist: 2 of 2 done. Contacts: 3 linked, 2 created, 1 skipped (1 no email or phone), 1 failed.");
    expect(describeTally({ ...emptyTally(), linked: 1, otherCompany: 2 })).toBe("3 contacts: 1 linked, 0 created, 2 skipped (2 already in another Company (left there))");
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

describe("rows not reached in a batch", () => {
  it("are queued again instead of being dropped, and a batch always moves forward", async () => {
    const { splitReached } = await import("./selection-run");
    expect(splitReached(["a", "b", "c"], ["c"])).toEqual({ done: ["a", "b"], left: ["c"] });
    // A person just added to AIS Connect comes back under their new key.
    expect(splitReached(["d:1", "a:2"], ["a:9"])).toEqual({ done: ["d:1", "a:2"], left: ["a:9"] });
    expect(splitReached(["a", "b"], ["a", "b"])).toEqual({ done: ["a"], left: ["b"] });
    expect(splitReached(["a"], undefined)).toEqual({ done: ["a"], left: [] });
  });
});

describe("a run whose work runs out of time", () => {
  it("finishes every row, without the 'click again' note, and reports once", async () => {
    const { startSelectionRun, stepSelectionRun } = await import("./selection-run");
    const ids = Array.from({ length: 23 }, (_, i) => `row${i}`);
    await startSelectionRun("mapping", { action: "test", label: "Synced to Lead Alchemist", ids, scopeText: "23 ticked" }, "staff:amy@x.com");
    const seen: string[] = [];
    // Each batch only gets to its first 3 rows, like a sync hitting its time limit.
    const work = () => async (chunk: string[]) => {
      seen.push(...chunk.slice(0, 3));
      return { done: Math.min(3, chunk.length), notes: ["7 weren't reached in this run (time limit per click): click again to do the rest."], notReached: chunk.slice(3) };
    };
    let run = await stepSelectionRun("mapping", work, 0);
    for (let i = 0; i < 30 && run?.phase === "running"; i++) run = await stepSelectionRun("mapping", work, 0);
    expect(run?.phase).toBe("done");
    expect(seen.sort()).toEqual([...ids].sort());
    expect(run?.done).toBe(23);
    expect(run?.notes.some((n) => /reached/.test(n))).toBe(false);
    expect(run?.report?.clean).toBe(true);
  });
});
