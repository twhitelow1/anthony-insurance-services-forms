import Link from "next/link";
import { SelectionRunPanel } from "@/components/SelectionRunPanel";
import { requireStaff } from "@/lib/auth/session";
import { importTargets, listImportSources } from "@/lib/applications/la-import";
import { getSelectionRun, showSelectionRun } from "@/lib/bulk/selection-run";
import { readFlash } from "@/lib/flash";
import { ghlConfig } from "@/lib/ghl/client";
import { FlashMessage } from "../salesforce/ui";
import { saveImportMapAction, startImportAction, stepImportRunAction, stopImportRunAction } from "./actions";

export const metadata = { title: "Import old applications | AIS Connect" };
export const dynamic = "force-dynamic";

const fmt = (n: number) => n.toLocaleString("en-US");

/** Bring past Lead Alchemist form and survey submissions into AIS Connect as applications. */
export default async function ImportPage({ searchParams }: PageProps<"/admin/import">) {
  await requireStaff("/admin/import");
  const sp = await searchParams;
  const [flash, run, connected] = await Promise.all([readFlash(sp.f), getSelectionRun("la_import"), ghlConfig()]);
  let error: string | null = connected ? null : "Lead Alchemist isn't connected yet (Settings → Integrations).";
  const data = connected ? await listImportSources().catch((err) => ((error = err instanceof Error ? err.message : String(err)), null)) : null;
  const targets = importTargets();
  const title = (slug: string) => targets.find((t) => t.slug === slug)?.title ?? slug;
  const toImport = data?.sources.filter((s) => s.slug) ?? [];
  const totalWaiting = toImport.reduce((n, s) => n + (s.submissions ?? 0), 0);
  const running = run?.phase === "running";
  return (
    <div>
      <p className="mb-2 text-sm">
        <Link className="btn-link" href="/admin/settings#tools">← Settings</Link>
      </p>
      <h1 className="mb-1 text-2xl font-semibold">Import old applications from Lead Alchemist</h1>
      <p className="mb-4 max-w-3xl text-sm text-[var(--muted)]">
        Every submission of the Lead Alchemist forms (and survey) our forms were copied from becomes an application here, marked{" "}
        <strong>Imported from Lead Alchemist</strong>, with its original date, on the right account and contact (matched by email, like a new
        application). Answers go to the matching question; anything that doesn&apos;t match is listed on the application under &quot;Other answers
        from Lead Alchemist&quot;. Nothing is sent anywhere: no emails, no Lead Alchemist or Salesforce syncs, no AI review. Running it again only
        brings in submissions that aren&apos;t here yet.
      </p>
      <FlashMessage flash={flash} />
      {showSelectionRun(run) && <SelectionRunPanel run={run} back="/admin/import" stepAction={stepImportRunAction} stopAction={stopImportRunAction} />}
      {error && (
        <p className="mb-4 rounded-lg bg-[var(--danger-bg)] p-3 text-sm text-[var(--danger)]" role="alert">
          {error}
        </p>
      )}
      {data && (
        <>
          <div className="card mb-4 flex flex-wrap items-center justify-between gap-3 !p-4 text-sm">
            <p>
              <strong>{fmt(totalWaiting)}</strong> submissions in {toImport.length} Lead Alchemist form{toImport.length === 1 ? "" : "s"} set to import ·{" "}
              <strong>{fmt(Object.values(data.imported).reduce((a, b) => a + b, 0))}</strong> already imported
            </p>
            <form action={startImportAction}>
              <button className="btn-primary" disabled={running || !toImport.length}>
                {running ? "Importing…" : "Import all"}
              </button>
            </form>
          </div>
          <form action={saveImportMapAction} className="card overflow-x-auto !p-0">
            <table className="data-table">
              <thead>
                <tr>
                  <th>Lead Alchemist form or survey</th>
                  <th>Submissions</th>
                  <th>Imports into</th>
                  <th>Imported so far</th>
                </tr>
              </thead>
              <tbody>
                {data.sources.map((s) => (
                  <tr key={s.key}>
                    <td>
                      {s.name} <span className="text-xs text-[var(--muted)]">({s.kind})</span>
                    </td>
                    <td>{s.submissions === null ? <span className="text-[var(--muted)]">—</span> : fmt(s.submissions)}</td>
                    <td>
                      <select name={`map:${s.key}`} defaultValue={s.slug} className="input !py-1 text-sm" aria-label={`Import ${s.name} into`}>
                        <option value="">Don&apos;t import</option>
                        {targets.map((t) => (
                          <option key={t.slug} value={t.slug}>{t.title}</option>
                        ))}
                      </select>
                    </td>
                    <td>{s.slug ? fmt(data.imported[s.slug] ?? 0) : ""}{s.slug && <span className="text-xs text-[var(--muted)]"> in {title(s.slug)}</span>}</td>
                  </tr>
                ))}
              </tbody>
            </table>
            <div className="flex items-center gap-3 p-4">
              <button className="btn-secondary">Save</button>
              <span className="text-sm text-[var(--muted)]">Pick a form for any Lead Alchemist form that held applications, then Import all.</span>
            </div>
          </form>
        </>
      )}
    </div>
  );
}
