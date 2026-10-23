import Link from "next/link";
import { requireStaff } from "@/lib/auth/session";
import { getBackfillState } from "@/lib/salesforce/backfill";
import { salesforceConfig } from "@/lib/salesforce/config";
import { continueBackfillAction, startApplyAction, startDryRunAction } from "./actions";

export const metadata = { title: "Link Salesforce accounts | Anthony Insurance Services" };

const ERRORS: Record<string, string> = {
  not_connected: "Salesforce isn't connected yet (SALESFORCE_* in Vercel).",
  batch_failed: "That batch failed (see the logs). Continue picks up where it stopped.",
  dry_run_first: "Finish a dry run and review its report before applying.",
  confirm: 'Type LINK to confirm applying.',
};

export default async function Backfill({ searchParams }: PageProps<"/admin/clients/backfill">) {
  await requireStaff("/admin/clients/backfill");
  const sp = await searchParams;
  const state = await getBackfillState();
  const connected = !!salesforceConfig();
  const total = state ? Object.values(state.counts).reduce((a, b) => a + b, 0) : 0;

  return (
    <div className="mx-auto max-w-3xl">
      <Link href="/admin/clients" className="btn-link">← Clients</Link>
      <h1 className="mt-3 text-2xl font-semibold">Link existing Salesforce accounts</h1>
      <p className="mb-6 text-sm text-[var(--muted)]">
        A one-time pass over every Salesforce Account and its Contacts. Each is linked to the client with the same email (a client is created if
        there&apos;s none), and the Account and Contacts get their Applications link and Lead Alchemist contact link. Nothing else in Salesforce is
        changed, and nothing is deleted. Run a dry run first and review its report.
      </p>
      {typeof sp.error === "string" && ERRORS[sp.error] && (
        <p className="mb-4 rounded-lg bg-[var(--danger-bg)] p-3 text-sm text-[var(--danger)]" role="alert">{ERRORS[sp.error]}</p>
      )}

      {state && (
        <section className="card mb-6 space-y-2 !p-5" aria-labelledby="run-heading">
          <h2 id="run-heading" className="font-semibold">
            {state.mode === "dry_run" ? "Dry run" : "Applying"} · {state.done ? "finished" : "in progress"}
          </h2>
          <p className="text-sm">
            {total} Accounts so far: {state.counts.matched} matched, {state.counts.new} new, {state.counts.ambiguous} ambiguous, {state.counts.skipped}{" "}
            skipped{state.counts.error ? `, ${state.counts.error} errors` : ""}.
          </p>
          {state.stoppedReason && <p className="text-sm text-[var(--danger)]">{state.stoppedReason}</p>}
          <p className="text-xs text-[var(--muted)]">Started {new Date(state.startedAt).toLocaleString("en-US")} · updated {new Date(state.updatedAt).toLocaleString("en-US")}</p>
          <div className="flex flex-wrap gap-2">
            <a className="btn-secondary" href={`/api/admin/salesforce-backfill?report=${state.runId}`} download>Download report (CSV)</a>
            {!state.done && (
              <form action={continueBackfillAction}>
                <button className="btn-primary">Continue</button>
              </form>
            )}
          </div>
          {!state.done && <p className="text-xs text-[var(--muted)]">Each click works for about 40 seconds. Keep clicking Continue until it finishes.</p>}
        </section>
      )}

      <section className="card space-y-4 !p-5">
        <form action={startDryRunAction}>
          <button className="btn-primary" disabled={!connected}>{state ? "Start a new dry run" : "Start a dry run"}</button>
          <p className="mt-1 text-xs text-[var(--muted)]">Reads Salesforce and the app, writes nothing anywhere, and builds the report.</p>
        </form>
        <form action={startApplyAction} className="space-y-2 border-t border-[var(--border)] pt-4">
          <label className="block text-sm" htmlFor="confirm">
            After reviewing the dry-run report, type <span className="font-mono font-semibold">LINK</span> to apply it for real.
          </label>
          <input id="confirm" name="confirm" className="input max-w-xs" autoComplete="off" />
          <button className="btn-secondary" disabled={!connected || !state || state.mode !== "dry_run" || !state.done}>
            Apply: link accounts and write links
          </button>
          <p className="text-xs text-[var(--muted)]">
            Ambiguous Accounts are left alone; fix or merge them, then run again. A CLI does the same: <code>node scripts/salesforce-backfill.mjs</code>.
          </p>
        </form>
      </section>
    </div>
  );
}
