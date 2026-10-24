import Link from "next/link";
import { cookies } from "next/headers";
import { SystemLink } from "@/components/clients";
import { requireStaff } from "@/lib/auth/session";
import { readFlash } from "@/lib/flash";
import { links } from "@/lib/integrations/links";
import { salesforceClient } from "@/lib/salesforce/client";
import { accountTypes, appSalesforceCounts, listSalesforceAccounts, MAX_OFFSET, NO_TYPE, type SfAccountListRow } from "@/lib/salesforce/manager";
import { resumeAccountAction, searchSalesforceAction, syncAccountAction, syncSelectedAccountsAction, unsyncAccountAction } from "./actions";
import { SF_SEARCH_COOKIE } from "./search-cookie";
import { ActionButton, AppStateBadge, FlashMessage } from "./ui";

export const metadata = { title: "Salesforce | Anthony Insurance Services" };
export const dynamic = "force-dynamic";

export default async function SalesforceAccounts({ searchParams }: PageProps<"/admin/salesforce">) {
  await requireStaff("/admin/salesforce");
  const sp = await searchParams;
  const q = (await cookies()).get(SF_SEARCH_COOKIE)?.value ?? "";
  const offset = Math.min(Math.max(0, Number(sp.offset) || 0), MAX_OFFSET);
  const flash = await readFlash(sp.f);
  const type = typeof sp.type === "string" && sp.type.length <= 80 ? sp.type : "";
  const sf = await salesforceClient();
  const l = await links();

  let list: Awaited<ReturnType<typeof listSalesforceAccounts>> | null = null;
  let types: string[] = [];
  let error: string | null = null;
  if (sf) {
    try {
      [list, types] = await Promise.all([listSalesforceAccounts(sf, { q, offset, type: type || null }), accountTypes(sf).catch(() => [])]);
    } catch (err) {
      error = err instanceof Error ? err.message : String(err);
    }
  }
  const counts = await appSalesforceCounts();
  const qs = (over: Record<string, string | number>) => {
    const p = new URLSearchParams({ ...(type ? { type } : {}), ...(offset ? { offset: String(offset) } : {}) });
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
        Every Account in Salesforce, and whether this app keeps it in sync. <strong>Sync</strong> brings an Account and its Contacts in and keeps
        them updated; <strong>Unsync</strong> stops syncing but keeps everything; removing an Account or Contact takes it out of this app only.
        This app never deletes anything in Salesforce or Lead Alchemist: open the record there to delete it.
      </p>
      <p className="mb-4 text-sm">
        In this app: <strong>{counts.synced}</strong> synced · <strong>{counts.unsynced}</strong> unsynced · <strong>{counts.removed}</strong> removed here
      </p>

      <FlashMessage flash={flash} />

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
              <p className="font-semibold">Salesforce isn&apos;t sharing everything with the app yet.</p>
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
            {types.length > 0 && (
              <form method="get" className="flex items-end gap-2">
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
                <button className="btn-secondary">Filter</button>
              </form>
            )}
          </div>

          {/* Row checkboxes belong to this form (form="sf-bulk"), so each row's own buttons can stay separate forms. */}
          <form id="sf-bulk" action={syncSelectedAccountsAction} className="mb-3 flex flex-wrap items-center gap-3 text-sm">
            <input type="hidden" name="back" value={back} />
            <button className="btn-primary">Sync selected into this app</button>
            <span className="text-[var(--muted)]">
              Tick Accounts (up to 25){type ? ` — showing Type: ${type === NO_TYPE ? "no type" : type}` : ""}. Brings each one and its Contacts in; nothing changes in Salesforce.
            </span>
          </form>

          <div className="overflow-x-auto">
            <table className="data-table">
              <thead>
                <tr>
                  <th className="w-8">
                    <span className="sr-only">Select</span>
                  </th>
                  <th>Salesforce Account</th>
                  <th>Type</th>
                  <th>Contacts</th>
                  <th>In this app</th>
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

          <div className="mt-4 flex flex-wrap items-center gap-3 text-sm">
            {offset > 0 && <Link className="btn-secondary" href={qs({ offset: Math.max(0, offset - (list?.pageSize ?? 50)) })}>← Previous</Link>}
            {list?.hasMore && <Link className="btn-secondary" href={qs({ offset: offset + list.pageSize })}>Next →</Link>}
            {offset + (list?.pageSize ?? 50) > MAX_OFFSET && <span className="text-[var(--muted)]">Salesforce lists up to {MAX_OFFSET} here; search to find others.</span>}
          </div>
        </>
      )}
    </div>
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
          {(r.appState === "not_in_app" || r.appState === "removed") && (
            <ActionButton action={syncAccountAction} fields={{ sfAccountId: r.id, back }} className="btn-primary">Sync</ActionButton>
          )}
          <SystemLink href={sfLink} missing="Add the Lightning URL in Settings → Integrations">View in Salesforce</SystemLink>
        </div>
      </td>
    </tr>
  );
}
