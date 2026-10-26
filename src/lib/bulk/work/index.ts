import "server-only";
import type { BatchResult, SelectionRun, SelectionScope } from "@/lib/bulk/selection-run";
import { ACCOUNTS_WORK } from "./accounts";
import { CONTACTS_WORK } from "./contacts";
import { MAPPING_WORK } from "./mapping";
import { importSubmissionPages } from "@/lib/applications/la-import";

const WORK: Record<SelectionScope, Record<string, { work: (ids: string[], actor: string, options: Record<string, string>) => Promise<BatchResult> }>> = {
  contacts: CONTACTS_WORK,
  mapping: MAPPING_WORK,
  accounts: ACCOUNTS_WORK,
  la_import: { importAll: { work: (ids, actor, o) => importSubmissionPages(ids, actor, o.runId) } },
};

/** The work a run's button does, for stepSelectionRun (null when the action no longer exists). */
export const selectionWork = (scope: SelectionScope) => (run: SelectionRun) => {
  const w = WORK[scope][run.action];
  // The run's ID goes along so the work can tag what it made (e.g. imports, to reverse one run).
  return w ? (ids: string[], actor: string) => w.work(ids, actor, { ...run.options, runId: run.runId }) : null;
};
