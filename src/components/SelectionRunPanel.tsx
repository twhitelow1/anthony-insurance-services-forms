import { AutoRefresh } from "@/components/AutoRefresh";
import { runStalled, type SelectionRun } from "@/lib/bulk/selection-run";

const fmt = (n: number) => n.toLocaleString("en-US");

/** Progress of a bulk run on a list. It runs in the background on the server; this only shows how far it got. */
export function SelectionRunPanel({
  run,
  back,
  stepAction,
  stopAction,
}: {
  run: SelectionRun;
  back: string;
  stepAction: (formData: FormData) => Promise<void>;
  stopAction: (formData: FormData) => Promise<void>;
}) {
  const total = run.ids.length;
  const pct = total ? Math.round((run.position / total) * 100) : 100;
  const by = run.startedBy.replace(/^staff:/, "");
  const stalled = runStalled(run);
  return (
    <section className="mb-4 rounded-lg border border-[var(--notice-border)] bg-[var(--notice-bg)] p-3 text-sm" role="status" aria-label="Run on all matching">
      <p className="font-semibold">
        {run.phase === "running" ? "Running" : run.phase === "done" ? "Finished" : "Stopped"}: {run.label} on all {fmt(total)} matching
      </p>
      <p className="mt-1">
        <strong>{fmt(run.position)}</strong> of <strong>{fmt(total)}</strong> worked through ({pct}%), <strong>{fmt(run.done)}</strong> done.
      </p>
      <p className="text-xs text-[var(--muted)]">
        {run.scopeText} · started by {by} on {new Date(run.startedAt).toLocaleString("en-US", { timeZone: process.env.APP_TIMEZONE ?? "America/Chicago" })}
      </p>
      {run.error && <p className="mt-1">{run.error}</p>}
      {run.report && (
        <p className={`mt-1 font-medium ${run.report.clean ? "text-[var(--success)]" : ""}`}>
          {run.report.clean ? "✓ " : "⚠ "}
          {run.report.text}{" "}
          <a className="btn-link" href={`/admin/sync-reports/${run.report.id}`}>See the full report</a>
        </p>
      )}
      <div className="mt-2 h-2 w-full overflow-hidden rounded bg-[var(--border)]" aria-hidden>
        <div className="h-full bg-[var(--accent)]" style={{ width: `${pct}%` }} />
      </div>
      {run.phase === "running" && (
        <div className="mt-2 flex flex-wrap items-center gap-2">
          <AutoRefresh />
          <form action={stopAction}>
            <input type="hidden" name="back" value={back} />
            <button className="btn-secondary">Stop</button>
          </form>
          {stalled ? (
            <form action={stepAction}>
              <input type="hidden" name="back" value={back} />
              <button className="btn-secondary" title="It hasn't moved for a few minutes">Continue</button>
            </form>
          ) : null}
          <span className="text-[var(--muted)]">Runs in the background: you can leave this page or close the browser. The sync report appears here and under Settings → Sync reports when it&apos;s done.</span>
        </div>
      )}
      {!run.report && run.notes.length > 0 && (
        <details className="mt-2">
          <summary className="cursor-pointer">Notes so far ({run.notes.length})</summary>
          <ul className="mt-1 list-disc pl-5">
            {run.notes.slice(-20).map((n, i) => (
              <li key={i}>{n}</li>
            ))}
          </ul>
        </details>
      )}
    </section>
  );
}
