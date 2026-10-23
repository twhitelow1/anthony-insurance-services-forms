import Link from "next/link";
import { cookies } from "next/headers";
import { fmtDate, StatusBadge } from "@/components/portal";
import { SalesforceBadge, SystemLink } from "@/components/clients";
import { requireStaff } from "@/lib/auth/session";
import { listClients, type ClientSort } from "@/lib/clients/repo";
import { links } from "@/lib/integrations/links";
import { CLIENT_SEARCH_COOKIE } from "@/lib/clients/search-cookie";
import { searchClientsAction } from "./actions";
import { linkAllGhlAction } from "@/app/admin/actions";
import { ghlConfig } from "@/lib/ghl/client";

export const metadata = { title: "Clients | Anthony Insurance Services" };

const SORTS: { value: ClientSort; label: string }[] = [
  { value: "latest", label: "Latest activity" },
  { value: "name", label: "Name (A–Z)" },
  { value: "applications", label: "Most applications" },
];
const PAGE_SIZE = 50;

export default async function Clients({ searchParams }: PageProps<"/admin/clients">) {
  await requireStaff("/admin/clients");
  const sp = await searchParams;
  const q = (await cookies()).get(CLIENT_SEARCH_COOKIE)?.value ?? "";
  const sort = SORTS.some((s) => s.value === sp.sort) ? (sp.sort as ClientSort) : "latest";
  const page = Math.max(1, Number(sp.page) || 1);
  const { rows, total } = await listClients({ q, sort, page, pageSize: PAGE_SIZE });
  const l = await links();
  const pages = Math.max(1, Math.ceil(total / PAGE_SIZE));
  const n = (k: string) => Math.max(0, Number(sp[k]) || 0);
  const ghlMessage =
    sp.ghl === "bulk"
      ? `Linked ${n("linked")} to Lead Alchemist.${n("missing") ? ` ${n("missing")} have no Lead Alchemist contact yet.` : ""}`
      : sp.ghl === "bulk_failed"
        ? `Stopped after linking ${n("linked")}: the Lead Alchemist lookup failed. Try again in a minute.`
        : sp.ghl === "not_connected"
          ? "Lead Alchemist isn't connected yet."
          : null;
  const qs = (over: Record<string, string | number>) => {
    const p = new URLSearchParams({ sort, page: String(page), ...Object.fromEntries(Object.entries(over).map(([k, v]) => [k, String(v)])) });
    return `?${p}`;
  };

  return (
    <div>
      <div className="mb-2 flex flex-wrap items-center justify-between gap-3">
        <h1 className="text-2xl font-semibold">Clients</h1>
        <div className="flex flex-wrap gap-2">
          <a className="btn-secondary" href={`/admin/clients/export${qs({ page: 1 })}`} download>
            Export CSV
          </a>
          <Link className="btn-secondary" href="/admin/clients/backfill">Link existing Salesforce accounts</Link>
          {ghlConfig() && (
            <form action={linkAllGhlAction}>
              <button className="btn-secondary" title="Find the Lead Alchemist contact for every client that isn't linked yet (50 per click)">
                Link to Lead Alchemist
              </button>
            </form>
          )}
        </div>
      </div>
      <p className="mb-6 text-sm text-[var(--muted)]">
        Every client and prospect, with all of their applications. Linked to their Salesforce Account and Lead Alchemist contact.
      </p>

      {ghlMessage && <p className="callout mb-4 text-sm" role="status">{ghlMessage}</p>}
      <form action={searchClientsAction} className="card mb-6 grid gap-3 !p-4 sm:grid-cols-[1fr_auto_auto_auto]" role="search">
        <label className="sr-only" htmlFor="q">Search clients</label>
        <input id="q" name="q" defaultValue={q} className="input" placeholder="Name, business, email or phone" />
        <label className="sr-only" htmlFor="sort">Sort</label>
        <select id="sort" name="sort" defaultValue={sort} className="input">
          {SORTS.map((s) => (
            <option key={s.value} value={s.value}>{s.label}</option>
          ))}
        </select>
        <button className="btn-primary">Search</button>
        {q && (
          <button className="btn-secondary" name="clear" value="1" title="Show every client">
            Clear
          </button>
        )}
      </form>

      <div className="card overflow-x-auto !p-0">
        <table className="data-table">
          <thead>
            <tr>
              <th>Client</th>
              <th>Email</th>
              <th>Phone</th>
              <th>Applications</th>
              <th>Latest</th>
              <th>Salesforce</th>
              <th>Lead Alchemist</th>
            </tr>
          </thead>
          <tbody>
            {rows.map((c) => (
              <tr key={c.id}>
                <td>
                  <Link className="row-link font-medium" href={`/admin/clients/${c.id}`}>{c.name}</Link>
                  {c.contactName && c.contactName !== c.name && <div className="text-xs text-[var(--muted)]">{c.contactName}</div>}
                </td>
                <td className="text-sm">{c.primaryEmail}</td>
                <td className="whitespace-nowrap text-sm">{c.phone ?? "—"}</td>
                <td>{c.applications}</td>
                <td className="whitespace-nowrap text-sm">
                  {c.latestStatus ? (
                    <>
                      <StatusBadge status={c.latestStatus} />
                      <div className="text-xs text-[var(--muted)]">{c.latestAt ? fmtDate(c.latestAt) : ""}</div>
                    </>
                  ) : c.prospect ? (
                    <span className="badge badge-warning" title="Started an application but hasn't submitted it">Prospect: unfinished</span>
                  ) : (
                    <span className="text-[var(--muted)]">—</span>
                  )}
                </td>
                <td>
                  {c.sfAccountId ? (
                    <a href={l.salesforce("Account", c.sfAccountId) ?? "#"} target="_blank" rel="noopener" title="Open the Account in Salesforce">
                      <SalesforceBadge status={c.sfStatus} />
                    </a>
                  ) : (
                    <SalesforceBadge status={c.sfStatus} />
                  )}
                </td>
                <td className="text-sm">
                  <SystemLink className="btn-link" href={l.ghlContact(c.ghlContactId)} missing="Not linked to a Lead Alchemist contact yet">
                    {c.ghlContactId ? "Linked" : "Not linked"}
                  </SystemLink>
                </td>
              </tr>
            ))}
            {!rows.length && (
              <tr>
                <td colSpan={7} className="py-10 text-center text-[var(--muted)]">{q ? "No clients match that search." : "No clients yet."}</td>
              </tr>
            )}
          </tbody>
        </table>
      </div>
      <nav className="mt-4 flex items-center justify-between text-sm" aria-label="Pages">
        <span className="text-[var(--muted)]">
          {total} client{total === 1 ? "" : "s"} · page {page} of {pages}
        </span>
        <span className="flex gap-3">
          {page > 1 && <Link className="btn-link" href={qs({ page: page - 1 })}>← Previous</Link>}
          {page < pages && <Link className="btn-link" href={qs({ page: page + 1 })}>Next →</Link>}
        </span>
      </nav>
    </div>
  );
}
