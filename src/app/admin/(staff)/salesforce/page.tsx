import Link from "next/link";
import { cookies } from "next/headers";
import { AutoSubmit } from "@/components/AutoSubmit";
import { SystemLink } from "@/components/clients";
import { SelectAll } from "@/components/SelectAll";
import { SelectAllMatching } from "@/components/SelectAllMatching";
import { requireStaff } from "@/lib/auth/session";
import { readFlash } from "@/lib/flash";
import { links } from "@/lib/integrations/links";
import { getBulkSync, type BulkSyncRun } from "@/lib/salesforce/bulk-sync";
import { salesforceClient } from "@/lib/salesforce/client";
import { accountTypes, appSalesforceCounts, listSalesforceAccounts, MAX_OFFSET, NO_TYPE, PAGE_SIZES, type SfAccountListRow } from "@/lib/salesforce/manager";
import {
  reactivateAccountAction,
  resumeAccountAction,
  resumeBulkSyncAction,
  searchSalesforceAction,
  startBulkSyncAction,
  stepBulkSyncAction,
  stopBulkSyncAction,
  syncAccountAction,
  syncSelectedAccountsAction,
  unsyncAccountAction,
} from "./actions";
import { SF_SEARCH_COOKIE } from "./search-cookie";
import { ActionButton, AppStateBadge, FlashMessage } from "./ui";

export const metadata = { title: "Salesforce | AIS Connect" };
export const dynamic = "force-dynamic";

export default async function SalesforceAccounts({ searchParams }: PageProps<"/admin/salesforce">) {
  await requireStaff("/admin/salesforce");
  const sp = await searchParams;
  const q = (await cookies()).get(SF_SEARCH_COOKIE)?.value ?? "";
  const offset = Math.min(Math.max(0, Number(sp.offset) || 0), MAX_OFFSET);
  const flash = await readFlash(sp.f);
  const type = typeof sp.type === "string" && sp.type.length <= 80 ? sp.type : "";
  const size = PAGE_SIZES.find((n) => n === Number(sp.size)) ?? 50;
  const sf = await salesforceClient();
  const l = await links();

  let list: Awaited<ReturnType<typeof listSalesforceAccounts>> | null = null;
  let types: string[] = [];
  let error: string | null = null;
  if (sf) {
    try {
      [list, types] = await Promise.all([listSalesforceAccounts(sf, { q, offset, type: type || null, pageSize: size }), accountTypes(sf).catch(() => [])]);
    } catch (err) {
      error = err instanceof Error ? err.message : String(err);
    }
  }
  const [counts, bulk] = await Promise.all([appSalesforceCounts(), getBulkSync()]);
  const bulkActive = bulk?.phase === "running" || bulk?.phase === "paused";
  const qs = (over: Record<string, string | number>) => {
    const p = new URLSearchParams({ ...(type ? { type } : {}), ...(size !== 50 ? { size: String(size) } : {}), ...(offset ? { offset: String(offset) } : {}) });
    for (const [k, v] of Object.entries(over)) {
      if (v === "" || v === 0) p.delete(k);
      else p.set(k, String(v));
    }
    const str = p.toString();
    return str ? `?${str}` : "";
  };
  const back = `/admin/salesforce${qs({})}`;

  return (
    <div>
      <div className="mb-2 flex flex-wrap items-center justify-between gap-3">
        <h1 className="text-2xl font-semibold">Salesforce Accounts</h1>
        <div className="flex flex-wrap gap-2">
          <Link className="btn-secondary" href="/admin/settings/integrations">Integrations</Link>
        </div>
      </div>
      <p className="mb-4 max-w-3xl text-sm text-[var(--muted)]">
        Every Account in Salesforce, and whether AIS Connect keeps it in sync. <strong>Sync</strong> brings an Account and its Contacts in and keeps
        them updated; <strong>Unsync</strong> stops syncing but keeps everything; removing an Account or Contact takes it out of AIS Connect only.
        AIS Connect never deletes anything in Salesforce or Lead Alchemist: open the record there to delete it.
      </p>
      <p className="mb-4 text-sm">
        In AIS Connect: <strong>{counts.synced}</strong> synced · <strong>{counts.unsynced}</strong> unsynced · <strong>{counts.deactivated}</strong> deactivated here
      </p>

      <FlashMessage flash={flash} />

      {sf && bulk && <BulkSyncPanel run={bulk} back={back} />}

      {!sf ? (
        <p className="callout callout-notice">
          Salesforce isn&apos;t connected. Add the keys in <Link className="btn-link" href="/admin/settings/integrations">Settings → Integrations</Link>.
        </p>
      ) : error ? (
        <p className="rounded-lg bg-[var(--danger-bg)] p-3 text-sm text-[var(--danger)]" role="alert">
          Couldn&apos;t read Salesforce: {error}. <Link className="btn-link" href="/admin/settings/integrations?test=salesforce">Test the connection</Link>.
        </p>
      ) : (
        <>
          {list && (!list.contactsVisible || list.hiddenFields.length > 0) && (
            <div className="mb-4 rounded-lg border border-[var(--notice-border)] bg-[var(--notice-bg)] p-3 text-sm" role="alert">
              <p className="font-semibold">Salesforce isn&apos;t sharing everything with AIS Connect yet.</p>
              <ul className="mt-1 list-disc pl-5">
                {!list.contactsVisible && <li>Contacts can&apos;t be read, so contact counts and contacts are missing.</li>}
                {list.hiddenFields.length > 0 && <li>These Account fields are hidden from the integration user: {list.hiddenFields.join(", ")}.</li>}
              </ul>
              <p className="mt-1">
                In Salesforce, open Setup → Permission Sets → DubLow Integration Access and give Read (and Edit) on Contacts and on those fields, then{" "}
                <Link className="btn-link" href="/admin/settings/integrations?test=salesforce">run the connection test</Link>.
              </p>
            </div>
          )}

          <div className="card mb-4 flex flex-wrap items-end gap-3 !p-4">
            <form action={searchSalesforceAction} className="flex flex-1 flex-wrap gap-3" role="search">
              <input type="hidden" name="back" value={back} />
              <label className="sr-only" htmlFor="q">Search Salesforce Accounts</label>
              <input id="q" name="q" defaultValue={q} className="input min-w-[12rem] flex-1" placeholder="Account name" />
              <button className="btn-primary">Search</button>
              {q && (
                <button name="clear" value="1" className="btn-secondary">Clear</button>
              )}
            </form>
            <form method="get" className="flex flex-wrap items-end gap-2">
              {types.length > 0 && (
                <label className="text-sm">
                  <span className="field-label !mb-1">Account Type</span>
                  <select name="type" defaultValue={type} className="input">
                    <option value="">All types</option>
                    {types.map((t) => (
                      <option key={t} value={t}>{t}</option>
                    ))}
                    <option value={NO_TYPE}>No type</option>
                  </select>
                </label>
              )}
              <label className="text-sm">
                <span className="field-label !mb-1">Per page</span>
                <select name="size" defaultValue={String(size)} className="input">
                  {PAGE_SIZES.map((n) => (
                    <option key={n} value={n}>{n}</option>
                  ))}
                </select>
              </label>
              <button className="btn-secondary">Filter</button>
            </form>
          </div>

          {/* Row checkboxes belong to this form (form="sf-bulk"), so each row's own buttons can stay separate forms. */}
          <form id="sf-bulk" action={syncSelectedAccountsAction} className="mb-3 flex flex-wrap items-center gap-3 text-sm">
            <input type="hidden" name="back" value={back} />
            <button className="btn-primary">Sync selected into AIS Connect</button>
            <span className="text-[var(--muted)]">
              Tick Accounts (up to 50){type ? ` — showing Type: ${type === NO_TYPE ? "no type" : type}` : ""}. Brings each one and its Contacts in; nothing changes in Salesforce.
            </span>
          </form>

          {list && list.total !== null && !bulkActive && (
            <SelectAllMatching form="sf-bulk" onPage={list.rows.length} total={list.total}>
              <form action={startBulkSyncAction} className="space-y-2">
                <input type="hidden" name="back" value={back} />
                <input type="hidden" name="type" value={type} />
                <p>
                  Sync all {fmt(list.total)} into AIS Connect{q ? ` (name contains "${q}")` : ""}
                  {type ? ` (Type: ${type === NO_TYPE ? "no type" : type})` : ""}. Each Account and its Contacts come in; deactivated Accounts
                  are skipped. It runs in batches while this page is open, and you can stop it at any time. Nothing changes in Salesforce unless you
                  tick the box below.
                </p>
                <label className="flex items-center gap-2">
                  <input type="checkbox" name="writeLinks" value="yes" /> Also write AIS Connect&apos;s links onto each Salesforce Account and Contact
                  (about one Salesforce API call per record)
                </label>
                <label className="flex items-center gap-2">
                  <input type="checkbox" name="confirm" value="yes" required /> Sync all {fmt(list.total)} matching Accounts
                </label>
                <button className="btn-primary">Sync all {fmt(list.total)}</button>
              </form>
            </SelectAllMatching>
          )}

          {list && <Summary total={list.total} offset={offset} shown={list.rows.length} filtered={!!(q || type)} />}

          <div className="overflow-x-auto">
            <table className="data-table">
              <thead>
                <tr>
                  <th className="w-8">
                    <SelectAll form="sf-bulk" />
                  </th>
                  <th>Salesforce Account</th>
                  <th>Type</th>
                  <th>Contacts</th>
                  <th>In AIS Connect</th>
                  <th>Actions</th>
                </tr>
              </thead>
              <tbody>
                {!list?.rows.length && (
                  <tr>
                    <td colSpan={6} className="text-[var(--muted)]">{q ? "No Salesforce Accounts match that name." : "No Accounts in Salesforce."}</td>
                  </tr>
                )}
                {list?.rows.map((r) => <Row key={r.id} r={r} back={back} sfLink={l.salesforce("Account", r.id)} />)}
              </tbody>
            </table>
          </div>

          {list && <Pager total={list.total} offset={offset} size={list.pageSize} hasMore={list.hasMore} qs={qs} />}
        </>
      )}
    </div>
  );
}

const fmt = (n: number) => n.toLocaleString("en-US");

/** Progress of a "Sync all matching" run. While it's running the Continue button submits itself. */
function BulkSyncPanel({ run, back }: { run: BulkSyncRun; back: string }) {
  const pct = run.total ? Math.min(100, Math.round((run.done / run.total) * 100)) : null;
  const scope = [run.q && `name contains "${run.q}"`, run.type && `Type: ${run.type === NO_TYPE ? "no type" : run.type}`].filter(Boolean).join(", ");
  const by = run.startedBy.replace(/^staff:/, "");
  const finished = run.phase === "done" || run.phase === "stopped";
  return (
    <div className={`mb-4 rounded-lg border p-3 text-sm ${finished ? "border-[var(--border)]" : "border-[var(--notice-border)] bg-[var(--notice-bg)]"}`} role="status">
      <p className="font-semibold">
        {run.phase === "running" && "Syncing all matching Accounts…"}
        {run.phase === "paused" && "Sync of all matching Accounts is paused"}
        {run.phase === "done" && "Sync of all matching Accounts finished"}
        {run.phase === "stopped" && "Sync of all matching Accounts was stopped"}
      </p>
      <p className="mt-1">
        <strong>{fmt(run.done)}</strong>
        {run.total !== null && <> of <strong>{fmt(run.total)}</strong></>} done{pct !== null && ` (${pct}%)`}: {fmt(run.created)} added, {fmt(run.linked)} linked
        or updated, {fmt(run.skipped)} skipped (deactivated or removed here){run.failed ? `, ${fmt(run.failed)} failed` : ""}.
      </p>
      <p className="text-xs text-[var(--muted)]">
        {scope ? `${scope} · ` : "All Accounts · "}
        {run.writeLinks ? "writing links back to Salesforce" : "not writing to Salesforce"} · started by {by} on{" "}
        {new Date(run.startedAt).toLocaleString("en-US", { timeZone: process.env.APP_TIMEZONE ?? "America/Chicago" })}
      </p>
      {run.pausedReason && <p className="mt-1">{run.pausedReason}</p>}
      {pct !== null && (
        <div className="mt-2 h-2 w-full overflow-hidden rounded bg-[var(--border)]" aria-hidden>
          <div className="h-full bg-[var(--accent)]" style={{ width: `${pct}%` }} />
        </div>
      )}
      <div className="mt-2 flex flex-wrap items-center gap-2">
        {run.phase === "running" && (
          <form action={stepBulkSyncAction}>
            <input type="hidden" name="back" value={back} />
            <AutoSubmit label="Continue" />
          </form>
        )}
        {run.phase === "paused" && (
          <ActionButton action={resumeBulkSyncAction} fields={{ back }} className="btn-primary">Resume</ActionButton>
        )}
        {!finished && <ActionButton action={stopBulkSyncAction} fields={{ back }}>Stop</ActionButton>}
        {run.phase === "running" && <span className="text-[var(--muted)]">Continues on its own while this page is open.</span>}
      </div>
      {run.errors.length > 0 && (
        <details className="mt-2">
          <summary className="cursor-pointer">Recent errors ({run.errors.length})</summary>
          <ul className="mt-1 list-disc pl-5">
            {run.errors.map((e, i) => (
              <li key={i}>
                <strong>{e.name}</strong>: {e.error}
              </li>
            ))}
          </ul>
        </details>
      )}
    </div>
  );
}

/** "Showing 51–100 of 1,234 Salesforce Accounts". */
function Summary({ total, offset, shown, filtered }: { total: number | null; offset: number; shown: number; filtered: boolean }) {
  if (!shown) return null;
  return (
    <p className="mb-2 text-sm" role="status">
      Showing <strong>{fmt(offset + 1)}–{fmt(offset + shown)}</strong>
      {total !== null && (
        <>
          {" "}of <strong>{fmt(total)}</strong>
        </>
      )}{" "}
      Salesforce Account{total === 1 ? "" : "s"}
      {filtered ? " matching" : ""}
    </p>
  );
}

/** Page links. Salesforce lists rows by position only up to 2,000, so later rows need a search or filter. */
function Pager({
  total,
  offset,
  size,
  hasMore,
  qs,
}: {
  total: number | null;
  offset: number;
  size: number;
  hasMore: boolean;
  qs: (over: Record<string, string | number>) => string;
}) {
  const reachable = Math.min(total ?? offset + size * (hasMore ? 2 : 1), MAX_OFFSET + size);
  const pages = Math.max(1, Math.ceil(reachable / size));
  const current = Math.floor(offset / size) + 1;
  if (pages <= 1 && current === 1) return null;
  const go = (p: number) => qs({ offset: (p - 1) * size });
  const around = [...new Set([1, current - 2, current - 1, current, current + 1, current + 2, pages])].filter((p) => p >= 1 && p <= pages).sort((a, b) => a - b);
  return (
    <nav className="mt-4 flex flex-wrap items-center gap-2 text-sm" aria-label="Pages">
      {current > 1 && <Link className="btn-secondary !px-3 !py-1" href={go(current - 1)}>← Previous</Link>}
      {around.map((p, i) => (
        <span key={p} className="flex items-center gap-2">
          {i > 0 && p - around[i - 1] > 1 && <span className="text-[var(--muted)]">…</span>}
          {p === current ? (
            <span className="badge badge-active" aria-current="page">{p}</span>
          ) : (
            <Link className="btn-link" href={go(p)}>{p}</Link>
          )}
        </span>
      ))}
      {hasMore && <Link className="btn-secondary !px-3 !py-1" href={go(current + 1)}>Next →</Link>}
      <span className="text-[var(--muted)]">
        Page {current} of {pages}
        {total !== null && total > MAX_OFFSET + size && ` · Salesforce pages through the first ${fmt(MAX_OFFSET + size)}; search or filter by Type to reach the rest`}
      </span>
    </nav>
  );
}

function Row({ r, back, sfLink }: { r: SfAccountListRow; back: string; sfLink: string | null }) {
  const place = [r.city, r.state].filter(Boolean).join(", ");
  return (
    <tr>
      <td>
        <input type="checkbox" name="ids" value={r.id} form="sf-bulk" aria-label={`Select ${r.name}`} />
      </td>
      <td>
        <Link className="btn-link font-medium" href={`/admin/salesforce/${r.id}`}>{r.name}</Link>
        {place && <div className="text-xs text-[var(--muted)]">{place}</div>}
        {r.client && r.client.name !== r.name && <div className="text-xs text-[var(--muted)]">Here: {r.client.name}</div>}
      </td>
      <td>{r.type ? <span className="badge badge-neutral">{r.type}</span> : <span className="text-[var(--muted)]">—</span>}</td>
      <td>{r.contacts ?? <span className="text-[var(--muted)]" title="The integration user can't read Contacts">—</span>}</td>
      <td>
        <AppStateBadge state={r.appState} />
      </td>
      <td>
        <div className="flex flex-wrap gap-2">
          {r.appState === "synced" && r.client && (
            <>
              <Link className="btn-secondary" href={`/admin/clients/${r.client.id}`}>Open here</Link>
              <ActionButton action={syncAccountAction} fields={{ sfAccountId: r.id, back }}>Sync now</ActionButton>
              <ActionButton action={unsyncAccountAction} fields={{ clientId: r.client.id, back }}>Unsync</ActionButton>
            </>
          )}
          {r.appState === "unsynced" && r.client && (
            <>
              <Link className="btn-secondary" href={`/admin/clients/${r.client.id}`}>Open here</Link>
              <ActionButton action={resumeAccountAction} fields={{ clientId: r.client.id, back }} className="btn-primary">Sync again</ActionButton>
            </>
          )}
          {r.appState === "deactivated" && r.client && (
            <>
              <Link className="btn-secondary" href={`/admin/clients/${r.client.id}`}>Open here</Link>
              <ActionButton action={reactivateAccountAction} fields={{ clientId: r.client.id, back }}>Reactivate</ActionButton>
            </>
          )}
          {(r.appState === "not_in_app" || r.appState === "removed") && (
            <ActionButton action={syncAccountAction} fields={{ sfAccountId: r.id, back }} className="btn-primary">Sync</ActionButton>
          )}
          <SystemLink href={sfLink} missing="Add the Lightning URL in Settings → Integrations">View in Salesforce</SystemLink>
        </div>
      </td>
    </tr>
  );
}
