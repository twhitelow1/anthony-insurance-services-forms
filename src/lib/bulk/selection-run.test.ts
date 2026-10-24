import { describe, expect, it } from "vitest";
import { getSelectionRun, MAX_SELECTION, showSelectionRun, startSelectionRun, stepSelectionRun, stopSelectionRun } from "./selection-run";

const ACTOR = "staff:amy@anthonyinsuranceservices.com";

describe("select all matching runs", () => {
  it("works through every ID in batches, one run per list, and can be stopped", async () => {
    const ids = Array.from({ length: 25 }, (_, i) => `id-${i}`);
    const run = await startSelectionRun("mapping", { action: "accountsToLa", label: "Synced", options: { createMissing: "yes" }, ids: [...ids, "id-0"], scopeText: "Accounts" }, ACTOR);
    expect(run.ids).toHaveLength(25); // duplicates dropped
    await expect(startSelectionRun("mapping", { action: "x", label: "Other", ids: ["a"], scopeText: "" }, ACTOR)).rejects.toThrow(/still running/);

    const seen: string[] = [];
    let options: Record<string, string> = {};
    const work = () => async (batch: string[]) => {
      seen.push(...batch);
      return { done: batch.length - 1, notes: [`batch of ${batch.length}`] };
    };
    // A tiny time budget still does at least one batch per step.
    let r = await stepSelectionRun("mapping", (x) => ((options = x.options), work()), 0);
    expect(r).toMatchObject({ phase: "running", position: 10 });
    expect(options).toEqual({ createMissing: "yes" });
    r = await stepSelectionRun("mapping", work);
    expect(r).toMatchObject({ phase: "done", position: 25, done: 22 });
    expect(seen).toEqual(ids);
    expect(showSelectionRun(r)).toBe(true);

    // The next run can start once that one is finished; stopping keeps what was done.
    await startSelectionRun("mapping", { action: "accountsToLa", label: "Synced", ids: ["a", "b"], scopeText: "" }, ACTOR);
    expect((await stopSelectionRun("mapping", ACTOR))!.phase).toBe("stopped");
    expect((await stepSelectionRun("mapping", work))!.position).toBe(0);
  });

  it("stops on an error instead of skipping rows, and refuses empty or huge selections", async () => {
    await startSelectionRun("contacts", { action: "toSalesforce", label: "Linked", ids: ["a", "b"], scopeText: "" }, ACTOR);
    const r = await stepSelectionRun("contacts", () => async () => {
      throw new Error("Salesforce isn't connected.");
    });
    expect(r).toMatchObject({ phase: "stopped", position: 0, error: "Salesforce isn't connected." });
    expect((await getSelectionRun("contacts"))!.phase).toBe("stopped");
    await expect(startSelectionRun("contacts", { action: "a", label: "A", ids: [], scopeText: "" }, ACTOR)).rejects.toThrow(/Nothing matches/);
    const huge = Array.from({ length: MAX_SELECTION + 1 }, (_, i) => String(i));
    await expect(startSelectionRun("contacts", { action: "a", label: "A", ids: huge, scopeText: "" }, ACTOR)).rejects.toThrow(/narrow the filters/);
    // An action that no longer exists stops the run.
    await startSelectionRun("contacts", { action: "gone", label: "Gone", ids: ["a"], scopeText: "" }, ACTOR);
    expect((await stepSelectionRun("contacts", () => null))!.phase).toBe("stopped");
  });
});
