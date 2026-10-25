import Link from "next/link";
import { cookies } from "next/headers";
import { ListSummary, pageHref, pageState, Pagination } from "@/components/Pagination";
import { requireStaff } from "@/lib/auth/session";
import { listContactChanges } from "@/lib/contacts/changes";
import { CHANGE_SEARCH_COOKIE } from "@/lib/contacts/changes-search";
import { searchChangesAction } from "./actions";

export const metadata = { title: "Change log | AIS Connect" };
export const dynamic = "force-dynamic";

const SYSTEMS = { salesforce: "Salesforce", lead_alchemist: "Lead Alchemist", ais_connect: "AIS Connect" } as const;
type System = keyof typeof SYSTEMS;

/** Every change a sync made or saw on a person, newest first. */
export default async function ChangeLogPage({ searchParams }: PageProps<"/admin/changes">) {
  await requireStaff("/admin/changes");
  const sp = await searchParams;
  const system = (Object.keys(SYSTEMS) as System[]).find((s) => s === sp.system);
  const q = (await cookies()).get(CHANGE_SEARCH_COOKIE)?.value ?? "";
  const paging = pageState(sp);
  const { rows, total } = await listContactChanges({ q, system, limit: paging.pageSize, offset: paging.offset });
  const tz = process.env.APP_TIMEZONE ?? "America/Chicago";
  return (
    <div>
      <p className="mb-2 text-sm">
        <Link className="btn-link" href="/admin/settings#tools">← Settings</Link>
      </p>
      <h1 className="mb-1 text-2xl font-semibold">Change log</h1>
      <p className="mb-4 max-w-3xl text-sm text-[var(--muted)]">
        Every change the syncs made or saw on a person: a value read from Salesforce or Lead Alchemist that changed since last time, each field AIS
        Connect wrote to Lead Alchemist, contacts created or linked there, Companies joined and client tier changes. Each account page shows its
        people&apos;s history too.
      </p>
      <form action={searchChangesAction} className="card mb-4 flex flex-wrap items-end gap-3 !p-4" role="search">
        <label className="flex-1 text-sm">
          <span className="field-label !mb-1">Person, field or value</span>
          <input name="q" defaultValue={q} className="input" placeholder="e.g. a name, Contact Type, Customer" />
        </label>
        <label className="text-sm">
          <span className="field-label !mb-1">System</span>
          <select name="system" defaultValue={system ?? ""} className="input">
            <option value="">Any</option>
            {(Object.keys(SYSTEMS) as System[]).map((s) => (
              <option key={s} value={s}>{SYSTEMS[s]}</option>
            ))}
          </select>
        </label>
        <button className="btn-primary">Search</button>
        {(q || system) && (
          <button name="clear" value="1" className="btn-secondary">Clear</button>
        )}
      </form>
      <ListSummary total={total} state={paging} noun="change" />
      <div className="card overflow-x-auto !p-0">
        <table className="data-table text-sm">
          <thead>
            <tr>
              <th>When</th>
              <th>Person</th>
              <th>System</th>
              <th>Change</th>
              <th>By</th>
            </tr>
          </thead>
          <tbody>
            {rows.map(({ change: c, name, clientId }) => (
              <tr key={c.id}>
                <td className="whitespace-nowrap">{c.createdAt.toLocaleString("en-US", { timeZone: tz, dateStyle: "short", timeStyle: "short" })}</td>
                <td>
                  <Link className="btn-link" href={`/admin/clients/${clientId}`}>{name}</Link>
                </td>
                <td>
                  {SYSTEMS[c.system]} <span className="text-xs text-[var(--muted)]">{c.direction === "wrote" ? "(updated by AIS Connect)" : "(changed there)"}</span>
                </td>
                <td>
                  <strong>{c.field}</strong>
                  {c.oldValue || c.newValue ? `: ${c.oldValue ?? "(empty)"} → ${c.newValue ?? "(empty)"}` : ""}
                </td>
                <td className="text-xs text-[var(--muted)]">{c.actor.replace(/^staff:/, "").replace("salesforce:change", "change in Salesforce")}</td>
              </tr>
            ))}
            {!rows.length && (
              <tr>
                <td colSpan={5} className="text-[var(--muted)]">No changes logged yet.</td>
              </tr>
            )}
          </tbody>
        </table>
      </div>
      <Pagination total={total} state={paging} noun="change" href={pageHref("/admin/changes", { system })} />
    </div>
  );
}
