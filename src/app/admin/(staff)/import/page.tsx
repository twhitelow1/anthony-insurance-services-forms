import Link from "next/link";
import { SelectAll } from "@/components/SelectAll";
import { SelectionRunPanel } from "@/components/SelectionRunPanel";
import { ShiftClickRange } from "@/components/ShiftClickRange";
import { requireStaff } from "@/lib/auth/session";
import { importedBySource, importTargets, listImportedFromSource, listImportSources, listSourceSubmissions } from "@/lib/applications/la-import";
import { getSelectionRun, showSelectionRun } from "@/lib/bulk/selection-run";
import { readFlash } from "@/lib/flash";
import { ghlConfig } from "@/lib/ghl/client";
import { FlashMessage } from "../salesforce/ui";
import { importPickedAction, importSelectedAction, saveImportMapAction, startImportAction, stepImportRunAction, stopImportRunAction, undoImportAction } from "./actions";

export const metadata = { title: "Import old applications | AIS Connect" };
export const dynamic = "force-dynamic";

const fmt = (n: number) => n.toLocaleString("en-US");
const tz = process.env.APP_TIMEZONE ?? "America/Chicago";
const SOURCE = /^(form|survey):[A-Za-z0-9]{6,64}$/;

/** A Lead Alchemist read, or why it failed (shown at the top of the page). */
const attempt = <T,>(p: Promise<T>): Promise<{ value: T | null; error: string | null }> =>
  p.then((value) => ({ value, error: null }), (err) => ({ value: null, error: err instanceof Error ? err.message : String(err) }));

/** Bring past Lead Alchemist form and survey submissions into AIS Connect as applications. */
export default async function ImportPage({ searchParams }: PageProps<"/admin/import">) {
  await requireStaff("/admin/import");
  const sp = await searchParams;
  const source = typeof sp.source === "string" && SOURCE.test(sp.source) ? sp.source : null;
  const page = Math.max(1, Number(sp.page) || 1);
  const back = source ? `/admin/import?source=${encodeURIComponent(source)}&page=${page}` : "/admin/import";
  const [flash, run, connected, bySource] = await Promise.all([readFlash(sp.f), getSelectionRun("la_import"), ghlConfig(), importedBySource()]);
  const sources = connected ? await attempt(listImportSources()) : { value: null, error: "Lead Alchemist isn't connected yet (Settings → Integrations)." };
  const data = sources.value;
  const submissions = source && data ? await attempt(listSourceSubmissions(source, page)) : { value: null, error: null };
  const list = submissions.value;
  const error = sources.error ?? submissions.error;
  const targets = importTargets();
  const title = (slug: string) => targets.find((t) => t.slug === slug)?.title ?? slug;
  const running = run?.phase === "running";

  const header = (
    <>
      <p className="mb-2 text-sm">
        {source ? (
          <Link className="btn-link" href="/admin/import">← All Lead Alchemist forms</Link>
        ) : (
          <Link className="btn-link" href="/admin/settings#tools">← Settings</Link>
        )}
      </p>
      <h1 className="mb-1 text-2xl font-semibold">Import old applications from Lead Alchemist</h1>
      <FlashMessage flash={flash} />
      {showSelectionRun(run) && <SelectionRunPanel run={run} back={back} stepAction={stepImportRunAction} stopAction={stopImportRunAction} />}
      {error && (
        <p className="mb-4 rounded-lg bg-[var(--danger-bg)] p-3 text-sm text-[var(--danger)]" role="alert">
          {error}
        </p>
      )}
    </>
  );

  // What one Lead Alchemist form or survey has brought in so far (works without the Lead Alchemist connection).
  if (source && sp.view === "imported") {
    const s = data?.sources.find((x) => x.key === source);
    const imported = await listImportedFromSource(source, page);
    const pages = Math.max(1, Math.ceil(imported.total / 100));
    const pageLink = (p: number) => `/admin/import?source=${encodeURIComponent(source)}&view=imported&page=${p}`;
    return (
      <div>
        {header}
        <h2 className="mb-1 text-lg font-semibold">
          Imported from {s?.name ?? source} <span className="text-sm font-normal text-[var(--muted)]">({s?.kind ?? source.split(":")[0]})</span>
        </h2>
        <p className="mb-4 text-sm text-[var(--muted)]">
          {fmt(imported.total)} application{imported.total === 1 ? "" : "s"} brought into AIS Connect, newest first.{" "}
          <Link className="btn-link" href={`/admin/import?source=${encodeURIComponent(source)}`}>See all its submissions</Link>
        </p>
        <div className="card overflow-x-auto !p-0">
          <table className="data-table">
            <thead>
              <tr>
                <th>Submitted</th>
                <th>Application</th>
                <th>Applicant</th>
                <th>Account</th>
                <th>Imported into</th>
              </tr>
            </thead>
            <tbody>
              {imported.rows.map((r) => (
                <tr key={r.id}>
                  <td className="whitespace-nowrap text-sm">{r.submittedAt.toLocaleDateString("en-US", { timeZone: tz })}</td>
                  <td>
                    <Link className="row-link font-medium" href={`/admin/applications/${r.id}`}>{r.reference}</Link>
                  </td>
                  <td>
                    {r.applicantName}
                    <div className="text-xs text-[var(--muted)]">{r.applicantEmail}</div>
                  </td>
                  <td>
                    {r.clientId ? (
                      <Link className="btn-link" href={`/admin/clients/${r.clientId}`}>{r.accountName ?? r.businessName ?? "Account"}</Link>
                    ) : (
                      <span className="text-[var(--muted)]">{r.businessName ?? "—"}</span>
                    )}
                  </td>
                  <td className="text-sm">{title(r.formSlug)}</td>
                </tr>
              ))}
              {!imported.rows.length && (
                <tr><td colSpan={5} className="text-sm text-[var(--muted)]">Nothing imported from this one yet.</td></tr>
              )}
            </tbody>
          </table>
        </div>
        {pages > 1 && (
          <nav className="mt-3 flex gap-3 text-sm" aria-label="Pages">
            {page > 1 && <Link className="btn-link" href={pageLink(page - 1)}>← Previous 100</Link>}
            {page < pages && <Link className="btn-link" href={pageLink(page + 1)}>Next 100 →</Link>}
          </nav>
        )}
      </div>
    );
  }

  // One Lead Alchemist form's submissions, to tick which to import.
  if (source && data) {
    const s = data.sources.find((x) => x.key === source);
    const pageLink = (p: number) => `/admin/import?source=${encodeURIComponent(source)}&page=${p}`;
    return (
      <div>
        {header}
        <h2 className="mb-1 text-lg font-semibold">
          {s?.name ?? source} <span className="text-sm font-normal text-[var(--muted)]">({s?.kind ?? source.split(":")[0]})</span>
        </h2>
        <p className="mb-4 text-sm text-[var(--muted)]">
          {s?.slug ? <>Imports into <strong>{title(s.slug)}</strong>.</> : <>Not set to import into any form yet: pick one on the list of forms and Save first.</>}{" "}
          Tick the submissions to bring in (shift-click to tick a range). Ones already imported are linked to their application.{" "}
          {(bySource[source] ?? 0) > 0 && (
            <Link className="btn-link" href={`/admin/import?source=${encodeURIComponent(source)}&view=imported`}>
              See the {fmt(bySource[source] ?? 0)} imported
            </Link>
          )}
        </p>
        {list && (
          <>
            <form id="pick" action={importPickedAction} className="card mb-3 flex flex-wrap items-center gap-3 !p-4 text-sm">
              <input type="hidden" name="source" value={source} />
              <input type="hidden" name="page" value={page} />
              <button className="btn-primary" disabled={running || !s?.slug}>Import ticked submissions</button>
              <span className="text-[var(--muted)]">
                {fmt(list.total)} submissions · page {page} of {list.pages}
              </span>
            </form>
            <ShiftClickRange />
            <div className="card overflow-x-auto !p-0">
              <table className="data-table">
                <thead>
                  <tr>
                    <th className="w-8"><SelectAll form="pick" label="Tick every submission on this page that isn't imported yet" /></th>
                    <th>Submitted</th>
                    <th>Name</th>
                    <th>Email</th>
                    <th>In AIS Connect</th>
                  </tr>
                </thead>
                <tbody>
                  {list.rows.map((r) => (
                    <tr key={r.id}>
                      <td>
                        {!r.applicationId && <input type="checkbox" name="ids" value={r.id} form="pick" aria-label={`Import ${r.name || r.email || r.id}`} />}
                      </td>
                      <td className="whitespace-nowrap text-sm">{r.date ? new Date(r.date).toLocaleDateString("en-US", { timeZone: tz }) : "—"}</td>
                      <td>{r.name || <span className="text-[var(--muted)]">—</span>}</td>
                      <td className="text-sm">{r.email ?? <span className="text-[var(--muted)]">No email (can&apos;t be imported)</span>}</td>
                      <td className="text-sm">
                        {r.applicationId ? (
                          <Link className="btn-link" href={`/admin/applications/${r.applicationId}`}>Imported</Link>
                        ) : (
                          <span className="text-[var(--muted)]">Not yet</span>
                        )}
                      </td>
                    </tr>
                  ))}
                  {!list.rows.length && (
                    <tr><td colSpan={5} className="text-sm text-[var(--muted)]">No submissions on this page.</td></tr>
                  )}
                </tbody>
              </table>
            </div>
            {list.pages > 1 && (
              <nav className="mt-3 flex gap-3 text-sm" aria-label="Pages">
                {page > 1 && <Link className="btn-link" href={pageLink(page - 1)}>← Previous 100</Link>}
                {page < list.pages && <Link className="btn-link" href={pageLink(page + 1)}>Next 100 →</Link>}
              </nav>
            )}
            {(bySource[source] ?? 0) > 0 && (
              <form action={undoImportAction} className="card mt-6 max-w-3xl space-y-2 !p-4 text-sm">
                <input type="hidden" name="source" value={source} />
                <h3 className="font-semibold">Undo this import</h3>
                <p>
                  Removes the <strong>{fmt(bySource[source] ?? 0)}</strong> application{bySource[source] === 1 ? "" : "s"} imported from this Lead Alchemist{" "}
                  {s?.kind ?? "form"} from AIS Connect. Nothing changes in Lead Alchemist or Salesforce; accounts and contacts stay. You can import them again later.
                </p>
                <label className="flex items-center gap-2">
                  <input type="checkbox" name="confirm" value="yes" required /> Yes, remove them from AIS Connect
                </label>
                <button className="btn-secondary" disabled={running}>Remove imported applications</button>
              </form>
            )}
          </>
        )}
      </div>
    );
  }

  const toImport = data?.sources.filter((s) => s.slug) ?? [];
  const totalWaiting = toImport.reduce((n, s) => n + (s.submissions ?? 0), 0);
  return (
    <div>
      {header}
      <p className="mb-4 max-w-3xl text-sm text-[var(--muted)]">
        Every submission of the Lead Alchemist forms and surveys our forms were copied from can become an application here, marked{" "}
        <strong>Imported from Lead Alchemist</strong>, with its original date, on the right account and contact (matched by email, like a new
        application). Answers go to the matching question; anything that doesn&apos;t match is listed on the application under &quot;Other answers
        from Lead Alchemist&quot;. Nothing is sent anywhere: no emails, no Lead Alchemist or Salesforce syncs, no AI review. Importing again only
        brings in submissions that aren&apos;t here yet.
      </p>
      {data && (
        <>
          <ShiftClickRange />
          <form id="import-map" action={saveImportMapAction} className="card overflow-x-auto !p-0">
            <div className="flex flex-wrap items-center gap-3 border-b border-[var(--border)] p-4 text-sm">
              <button className="btn-primary" formAction={importSelectedAction} disabled={running}>Import ticked forms</button>
              <button className="btn-secondary" formAction={startImportAction} disabled={running}>Import all</button>
              <span className="text-[var(--muted)]">
                <strong>{fmt(totalWaiting)}</strong> submissions in {toImport.length} form{toImport.length === 1 ? "" : "s"} set to import ·{" "}
                <strong>{fmt(Object.values(bySource).reduce((a, b) => a + b, 0))}</strong> already imported. Both buttons use the &quot;Imports into&quot; choices
                as shown (forms set to &quot;Don&apos;t import&quot; are skipped). Open a form to tick single submissions or undo its import.
              </span>
            </div>
            <table className="data-table">
              <thead>
                <tr>
                  <th className="w-8"><SelectAll form="import-map" label="Tick every form and survey" /></th>
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
                      <input type="checkbox" name="ids" value={s.key} form="import-map" aria-label={`Import ${s.name}`} />
                    </td>
                    <td>
                      <Link className="row-link font-medium" href={`/admin/import?source=${encodeURIComponent(s.key)}`}>{s.name}</Link>{" "}
                      <span className="text-xs text-[var(--muted)]">({s.kind})</span>
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
                    <td>
                      {bySource[s.key] ? (
                        <Link className="btn-link" href={`/admin/import?source=${encodeURIComponent(s.key)}&view=imported`}>{fmt(bySource[s.key])} imported</Link>
                      ) : (
                        <span className="text-[var(--muted)]">0</span>
                      )}
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
            <div className="flex items-center gap-3 p-4">
              <button className="btn-secondary">Save</button>
              <span className="text-sm text-[var(--muted)]">Pick a form for any Lead Alchemist form or survey that held applications, or &quot;Don&apos;t import&quot; to skip it.</span>
            </div>
          </form>
        </>
      )}
    </div>
  );
}
