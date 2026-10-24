import Link from "next/link";
import { notFound } from "next/navigation";
import { AutoSubmit } from "@/components/AutoSubmit";
import { requireStaff } from "@/lib/auth/session";
import type { MappingConfidence, MappingKind, MappingRow } from "@/lib/db/schema";
import { links } from "@/lib/integrations/links";
import type { Links } from "@/lib/integrations/urls";
import { finalChoice, getRun, listRows, MAPPING_TITLES, summarize, type RowFilter } from "@/lib/mapping/runs";
import { queuedJobCount } from "@/lib/salesforce/jobs";
import { getSettings } from "@/lib/settings";
import { confirmAction, continueAction, runQueuedSyncsAction, saveDecisionsAction, startScanAction } from "../actions";
import { KIND_SLUGS } from "../kinds";

export const metadata = { title: "Data mapping | Anthony Insurance Services" };

const PAGE_SIZE = 100;

/** Per mapping: what the two sides are called and how to link to them. */
const SIDES: Record<MappingKind, { source: string; target: string; createLabel: string; intro: string }> = {
  salesforce_import: {
    source: "Salesforce Account",
    target: "App account",
    createLabel: "Create a new app account",
    intro:
      "Every Salesforce Account, matched to the app's accounts by Contact email, then by name plus phone or website. Confirming links or creates each account, adds its Salesforce Contacts as contacts, and writes the app's link onto the Salesforce Account (link fields only).",
  },
  la_companies: {
    source: "App account",
    target: "Lead Alchemist Company",
    createLabel: "Create a new Company",
    intro:
      "Every account in the app, matched to Lead Alchemist's Companies by name (ignoring punctuation and LLC/Inc) or website. Confirming links or creates each Company and puts the account's contacts in it. A contact can only be in one Company.",
  },
  salesforce_push: {
    source: "App account",
    target: "Salesforce Account",
    createLabel: "Create a new Salesforce Account",
    intro:
      "Accounts with submitted applications that aren't in Salesforce yet (never test, declined or withdrawn ones). Confirming sets each account's Salesforce Account and queues its applications: each gets an Opportunity, the applicant as its contact, the PDF and a Chatter note.",
  },
};

const CONFIDENCE: Record<MappingConfidence, { label: string; tone: string; title: string }> = {
  exact: { label: "Already linked", tone: "badge-success", title: "These records are already linked" },
  strong: { label: "Strong match", tone: "badge-success", title: "Same name plus a matching phone, website or contact email" },
  name_only: { label: "Check", tone: "badge-warning", title: "Only the name matches: pick the right record" },
  none: { label: "No match", tone: "badge-neutral", title: "Nothing like it on the other side" },
};

const FILTERS: { value: RowFilter; label: string }[] = [
  { value: "all", label: "All" },
  { value: "check", label: "To check" },
  { value: "link", label: "Link" },
  { value: "create", label: "Create" },
  { value: "skip", label: "Skip" },
  { value: "error", label: "Errors" },
];

const ERRORS: Record<string, string> = {
  salesforce: "Salesforce isn't connected yet: set SALESFORCE_LOGIN_URL, SALESFORCE_CLIENT_ID and SALESFORCE_CLIENT_SECRET in Vercel (docs/salesforce-setup.md).",
  lead_alchemist: "Lead Alchemist isn't connected: set LA_API_TOKEN and LA_LOCATION_ID in Vercel. The token needs the Businesses scopes.",
  step_failed: "The last batch stopped with an error (shown below). Fix it and continue.",
  not_review: "There's no reviewed mapping to change or confirm. Scan first.",
  not_confirmed: "Tick the box to confirm you've reviewed the mapping.",
  sync_off: "The Salesforce sync is off (Admin → Settings → Salesforce). The applications stay queued until it's switched on.",
};

function targetHref(kind: MappingKind, id: string | null, l: Links): string | null {
  if (!id) return null;
  if (kind === "salesforce_import") return `/admin/clients/${id}`;
  if (kind === "la_companies") return l.ghlCompany(id);
  return l.salesforce("Account", id);
}
function sourceHref(kind: MappingKind, id: string, l: Links): string | null {
  return kind === "salesforce_import" ? l.salesforce("Account", id) : `/admin/clients/${id}`;
}

function SourceCell({ row, kind, l }: { row: MappingRow; kind: MappingKind; l: Links }) {
  const d = row.sourceDetail;
  const href = sourceHref(kind, row.sourceId, l);
  const place = [d.city, d.state].filter(Boolean).join(", ");
  return (
    <td className="align-top text-sm">
      {href ? (
        <a className="row-link font-medium" href={href} target={href.startsWith("http") ? "_blank" : undefined} rel="noopener">
          {row.sourceName}
        </a>
      ) : (
        <span className="font-medium">{row.sourceName}</span>
      )}
      <div className="text-xs text-[var(--muted)]">{[d.phone, d.website, place].filter(Boolean).join(" · ")}</div>
      {typeof d.applications === "number" && <div className="text-xs">{d.applications} application{d.applications === 1 ? "" : "s"}</div>}
      {!!d.contacts?.length && (
        <details className="mt-1 text-xs">
          <summary className="cursor-pointer">{d.contacts.length} contact{d.contacts.length === 1 ? "" : "s"}</summary>
          <ul className="mt-1 space-y-0.5">
            {d.contacts.map((c, i) => (
              <li key={`${c.email ?? c.name}-${i}`}>
                {c.name}
                {c.email && <span className="text-[var(--muted)]"> · {c.email}</span>}
                {kind === "la_companies" && (c.inLa ? <span className="badge badge-success ml-1">in Lead Alchemist</span> : null)}
              </li>
            ))}
          </ul>
        </details>
      )}
    </td>
  );
}

export default async function MappingKindPage({ params, searchParams }: PageProps<"/admin/settings/mapping/[kind]">) {
  const { kind: slug } = await params;
  const kind = KIND_SLUGS[slug];
  if (!kind) notFound();
  await requireStaff(`/admin/settings/mapping/${slug}`);
  const sp = await searchParams;
  const one = (k: string) => (typeof sp[k] === "string" ? (sp[k] as string) : null);
  const filter = (FILTERS.some((f) => f.value === one("filter")) ? one("filter") : "all") as RowFilter;
  const pageNo = Math.max(1, Number(one("page")) || 1);

  const run = await getRun(kind);
  const [l, summary, list, queued, settings] = await Promise.all([
    links(),
    run ? summarize(run.runId) : null,
    run && run.phase !== "scanning" ? listRows(run.runId, { filter, page: pageNo, pageSize: PAGE_SIZE }) : null,
    kind === "salesforce_push" ? queuedJobCount() : Promise.resolve(0),
    getSettings(),
  ]);
  const sides = SIDES[kind];
  const pages = list ? Math.max(1, Math.ceil(list.total / PAGE_SIZE)) : 1;
  const qs = (over: Record<string, string | number>) => `?${new URLSearchParams({ filter, page: String(pageNo), ...Object.fromEntries(Object.entries(over).map(([k, v]) => [k, String(v)])) })}`;
  const editable = run?.phase === "review";
  const error = one("error");

  return (
    <div>
      <Link href="/admin/settings/mapping" className="btn-link">← Data mapping</Link>
      <h1 className="mb-2 mt-3 text-2xl font-semibold">{MAPPING_TITLES[kind]}</h1>
      <p className="mb-4 max-w-3xl text-sm text-[var(--muted)]">{sides.intro}</p>

      {error && (
        <p className="mb-4 rounded-lg bg-[var(--danger-bg)] p-3 text-sm text-[var(--danger)]" role="alert">
          {ERRORS[error] ?? "Something went wrong."}
        </p>
      )}
      {run?.stoppedReason && (
        <p className="mb-4 rounded-lg border border-[var(--notice-border)] bg-[var(--notice-bg)] p-3 text-sm" role="alert">
          {run.stoppedReason}
        </p>
      )}
      {one("saved") && <p className="callout mb-4 text-sm" role="status">Saved {one("saved")} choice{one("saved") === "1" ? "" : "s"}.</p>}
      {one("ran") && (
        <p className="callout mb-4 text-sm" role="status">
          Ran {one("ran")} queued sync{one("ran") === "1" ? "" : "s"}{one("failed") !== "0" ? `, ${one("failed")} failed (see each application)` : ""}. {one("remaining")} still queued.
        </p>
      )}

      {/* ── Start / progress ── */}
      <section className="card mb-6 !p-5" aria-labelledby="status">
        <h2 id="status" className="sr-only">Status</h2>
        {!run && (
          <>
            <p className="mb-3 text-sm">Scanning reads only. It writes nothing anywhere.</p>
            <form action={startScanAction}>
              <input type="hidden" name="kind" value={slug} />
              <button className="btn-primary">Scan now</button>
            </form>
          </>
        )}
        {run?.phase === "scanning" && (
          <form action={continueAction} className="flex flex-wrap items-center gap-3">
            <input type="hidden" name="kind" value={slug} />
            <span className="text-sm">Scanning… {run.scanned} read so far. This page continues on its own; keep it open.</span>
            {!run.stoppedReason && <AutoSubmit label="Continue" />}
            {run.stoppedReason && <button className="btn-secondary">Continue</button>}
          </form>
        )}
        {run?.phase === "applying" && (
          <form action={continueAction} className="flex flex-wrap items-center gap-3">
            <input type="hidden" name="kind" value={slug} />
            <span className="text-sm">
              Applying… {run.applied} done{run.errors ? `, ${run.errors} errors` : ""} of {summary?.total ?? "?"}. This page continues on its own; keep it open.
            </span>
            {!run.stoppedReason && <AutoSubmit label="Continue" />}
            {run.stoppedReason && <button className="btn-secondary">Continue</button>}
          </form>
        )}
        {run && summary && run.phase !== "scanning" && (
          <div className="flex flex-wrap items-center justify-between gap-3">
            <p className="text-sm">
              <strong>{summary.total}</strong> records: <strong>{summary.link}</strong> to link, <strong>{summary.create}</strong> to create,{" "}
              <strong>{summary.skip}</strong> to skip.
              {summary.check > 0 && <> <span className="badge badge-warning">{summary.check} to check</span></>}
              {run.phase === "done" && <> Applied {summary.applied}{summary.errors ? `, ${summary.errors} errors` : ""}.</>}
              <span className="block text-xs text-[var(--muted)]">
                Scanned {new Date(run.startedAt).toLocaleString("en-US")} by {run.startedBy.replace(/^staff:/, "")}
                {run.confirmedBy && ` · confirmed by ${run.confirmedBy.replace(/^staff:/, "")}`}
              </span>
            </p>
            {run.phase !== "applying" && (
              <form action={startScanAction}>
                <input type="hidden" name="kind" value={slug} />
                <button className="btn-secondary" title="Start over with a fresh scan; the current choices are dropped">
                  Scan again
                </button>
              </form>
            )}
          </div>
        )}
        {kind === "salesforce_push" && run?.phase === "done" && (
          <form action={runQueuedSyncsAction} className="mt-3 flex flex-wrap items-center gap-3 border-t border-[var(--border)] pt-3">
            <input type="hidden" name="kind" value={slug} />
            <span className="text-sm">
              {queued} application{queued === 1 ? "" : "s"} queued for Salesforce
              {settings.salesforceDryRun ? " (Salesforce is in dry-run mode: nothing is written until it's switched to Live in Settings)" : ""}. They also run
              on their own once a day and whenever staff open the admin.
            </span>
            {queued > 0 && <button className="btn-primary">Run queued syncs now</button>}
          </form>
        )}
      </section>

      {/* ── The mapping table ── */}
      {list && (
        <>
          <nav className="mb-3 flex flex-wrap gap-2 text-sm" aria-label="Filter">
            {FILTERS.map((f) => (
              <Link key={f.value} className={f.value === filter ? "btn-primary" : "btn-secondary"} href={qs({ filter: f.value, page: 1 })}>
                {f.label}
              </Link>
            ))}
          </nav>
          <form action={saveDecisionsAction}>
            <input type="hidden" name="kind" value={slug} />
            <input type="hidden" name="back" value={qs({})} />
            <div className="card overflow-x-auto !p-0">
              <table className="data-table">
                <thead>
                  <tr>
                    <th>{sides.source}</th>
                    <th aria-label="maps to" />
                    <th>Proposed {sides.target.toLowerCase()}</th>
                    <th>Your choice</th>
                    <th>Result</th>
                  </tr>
                </thead>
                <tbody>
                  {list.rows.map((row) => {
                    const c = CONFIDENCE[row.confidence];
                    const choice = finalChoice(row);
                    const value = choice.action === "link" ? `link:${choice.targetId}` : choice.action;
                    const proposedHref = targetHref(kind, row.targetId, l);
                    const options = [
                      ...(row.targetId ? [{ id: row.targetId, name: row.targetName ?? row.targetId, note: "proposed" }] : []),
                      ...row.candidates.filter((x) => x.id !== row.targetId),
                    ];
                    const changed = row.decision !== null;
                    return (
                      <tr key={row.id} className={row.confidence === "name_only" ? "bg-[var(--notice-bg)]" : undefined}>
                        <SourceCell row={row} kind={kind} l={l} />
                        <td className="align-top text-lg text-[var(--muted)]" aria-hidden="true">→</td>
                        <td className="align-top text-sm">
                          <span className={`badge ${c.tone}`} title={c.title}>{c.label}</span>
                          <div className="mt-1">
                            {row.proposal === "link" && row.targetId ? (
                              proposedHref ? (
                                <a className="btn-link" href={proposedHref} target={proposedHref.startsWith("http") ? "_blank" : undefined} rel="noopener">
                                  {row.targetName}
                                </a>
                              ) : (
                                row.targetName
                              )
                            ) : row.proposal === "create" ? (
                              <em>{sides.createLabel}</em>
                            ) : (
                              <em>Skip</em>
                            )}
                          </div>
                          {row.reason && <div className="text-xs text-[var(--muted)]">{row.reason}</div>}
                        </td>
                        <td className="align-top text-sm">
                          {editable && row.status === "pending" ? (
                            <>
                              <label className="sr-only" htmlFor={`d_${row.id}`}>Choice for {row.sourceName}</label>
                              <select id={`d_${row.id}`} name={`d_${row.id}`} defaultValue={value} className="input min-w-56">
                                {options.map((o) => (
                                  <option key={o.id} value={`link:${o.id}`}>
                                    Link to {o.name}{o.note ? ` (${o.note})` : ""}
                                  </option>
                                ))}
                                <option value="create">{sides.createLabel}</option>
                                <option value="skip">Skip</option>
                              </select>
                              {changed && <div className="mt-1 text-xs text-[var(--accent-strong)]">Changed from the proposal</div>}
                            </>
                          ) : (
                            <span>
                              {choice.action === "link"
                                ? `Link to ${options.find((o) => o.id === choice.targetId)?.name ?? choice.targetId}`
                                : choice.action === "create"
                                  ? sides.createLabel
                                  : "Skip"}
                            </span>
                          )}
                        </td>
                        <td className="align-top text-sm">
                          {row.status === "applied" && <span className="badge badge-success">Done</span>}
                          {row.status === "error" && <span className="badge badge-danger">Error</span>}
                          {row.status === "pending" && <span className="text-xs text-[var(--muted)]">Not applied yet</span>}
                          {row.result && <div className="text-xs">{row.result}</div>}
                        </td>
                      </tr>
                    );
                  })}
                  {!list.rows.length && (
                    <tr>
                      <td colSpan={5} className="py-10 text-center text-[var(--muted)]">Nothing here.</td>
                    </tr>
                  )}
                </tbody>
              </table>
            </div>
            <div className="mt-3 flex flex-wrap items-center justify-between gap-3 text-sm">
              <span className="text-[var(--muted)]">
                {list.total} shown · page {pageNo} of {pages}{" "}
                {pageNo > 1 && <Link className="btn-link ml-2" href={qs({ page: pageNo - 1 })}>← Previous</Link>}
                {pageNo < pages && <Link className="btn-link ml-2" href={qs({ page: pageNo + 1 })}>Next →</Link>}
              </span>
              {editable && <button className="btn-secondary">Save choices on this page</button>}
            </div>
          </form>
        </>
      )}

      {/* ── Confirmation ── */}
      {run?.phase === "review" && summary && (
        <section className="card mt-6 !p-5" aria-labelledby="confirm">
          <h2 id="confirm" className="mb-2 font-semibold">Confirm and apply</h2>
          <p className="mb-3 text-sm">
            This will <strong>link {summary.link}</strong>, <strong>create {summary.create}</strong> and <strong>skip {summary.skip}</strong>, as shown in
            the table (save any changes on each page first).
            {summary.check > 0 && <> <strong>{summary.check}</strong> rows are marked &quot;Check&quot;: make sure they&apos;re right.</>}
          </p>
          <form action={confirmAction} className="space-y-3">
            <input type="hidden" name="kind" value={slug} />
            {kind === "la_companies" && (
              <>
                <label className="flex items-start gap-2 text-sm">
                  <input type="checkbox" name="createContacts" value="yes" className="mt-1" />
                  <span>
                    Also create Lead Alchemist contacts for people who aren&apos;t in Lead Alchemist yet. <em>Creating contacts can start Lead Alchemist
                    workflows</em>; leave this off to only connect people already there.
                  </span>
                </label>
                <label className="flex items-start gap-2 text-sm">
                  <input type="checkbox" name="moveContacts" value="yes" className="mt-1" />
                  <span>Move contacts who are already in a different Company. Off: they stay where they are and are listed in the result.</span>
                </label>
              </>
            )}
            <label className="flex items-start gap-2 text-sm">
              <input type="checkbox" name="reviewed" value="yes" className="mt-1" required />
              <span>I&apos;ve reviewed the mapping and want to apply it.</span>
            </label>
            <button className="btn-primary">Confirm and apply</button>
          </form>
        </section>
      )}
    </div>
  );
}
