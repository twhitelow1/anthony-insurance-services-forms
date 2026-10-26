import { ListSummary, pageHref, pageState, Pagination } from "@/components/Pagination";
import Link from "next/link";
import { cookies } from "next/headers";
import { fmtDate, StatusBadge } from "@/components/portal";
import { SalesforceBadge, SystemLink, LA_COMPANY_HINT } from "@/components/clients";
import { requireStaff } from "@/lib/auth/session";
import { countPossibleDuplicates, listClients, NO_ACCOUNT_TYPE, type ClientFilter, type ClientSort } from "@/lib/clients/repo";
import { accountTypesInApp } from "@/lib/mapping/database";
import { RECORD_SOURCE_LABEL, type RecordSource } from "@/lib/db/schema";
import { links } from "@/lib/integrations/links";
import { CLIENT_SEARCH_COOKIE } from "@/lib/clients/search-cookie";
import { searchClientsAction } from "./actions";
import { readFlash } from "@/lib/flash";
import { FlashMessage } from "../salesforce/ui";
import { AcrossView } from "./AcrossView";
import { AccountTabs as Tabs } from "./AccountTabs";

export const metadata = { title: "Accounts | AIS Connect" };

const SORTS: { value: ClientSort; label: string }[] = [
  { value: "latest", label: "Latest activity" },
  { value: "name", label: "Name (A–Z)" },
  { value: "applications", label: "Most applications" },
];
const FILTERS: { value: ClientFilter; label: string }[] = [
  { value: "all", label: "All accounts" },
  { value: "businesses", label: "Businesses" },
  { value: "individuals", label: "Individuals" },
  { value: "review", label: "Possible duplicates" },
  { value: "no_primary", label: "No primary contact (or one to check)" },
  { value: "deactivated", label: "Deactivated" },
];

export default async function Accounts({ searchParams }: PageProps<"/admin/clients">) {
  await requireStaff("/admin/clients");
  const sp = await searchParams;
  const q = (await cookies()).get(CLIENT_SEARCH_COOKIE)?.value ?? "";
  if (sp.view === "all") {
    const flash = await readFlash(sp.f);
    return (
      <div>
        <h1 className="mb-2 text-2xl font-semibold">Accounts</h1>
        <Tabs view="all" />
        <AcrossView sp={sp} q={q} flash={<FlashMessage flash={flash} />} />
      </div>
    );
  }
  const sort = SORTS.some((s) => s.value === sp.sort) ? (sp.sort as ClientSort) : "latest";
  const filter = FILTERS.some((f) => f.value === sp.filter) ? (sp.filter as ClientFilter) : "all";
  const type = typeof sp.type === "string" ? sp.type.slice(0, 80) : "";
  const source = typeof sp.source === "string" && sp.source in RECORD_SOURCE_LABEL ? (sp.source as RecordSource) : "";
  const paging = pageState(sp);
  const { page } = paging;
  const [{ rows, total }, duplicates, types] = await Promise.all([
    listClients({ q, sort, filter, type: type || null, source: source || null, page, pageSize: paging.pageSize }),
    countPossibleDuplicates(),
    accountTypesInApp(),
  ]);
  const l = await links();
  const n = (k: string) => Math.max(0, Number(sp[k]) || 0);
  const ghlMessage =
    sp.la === "bulk"
      ? `Linked ${n("linked")} to Lead Alchemist.${n("missing") ? ` ${n("missing")} have no Lead Alchemist contact yet.` : ""}`
      : sp.la === "bulk_failed"
        ? `Stopped after linking ${n("linked")}: the Lead Alchemist lookup failed. Try again in a minute.`
        : sp.la === "not_connected"
          ? "Lead Alchemist isn't connected yet."
          : null;
  const qs = (over: Record<string, string | number>) => {
    const p = new URLSearchParams({ sort, filter, ...(type ? { type } : {}), ...(source ? { source } : {}), page: String(page), ...Object.fromEntries(Object.entries(over).map(([k, v]) => [k, String(v)])) });
    return `?${p}`;
  };

  return (
    <div>
      <div className="mb-2 flex flex-wrap items-center justify-between gap-3">
        <h1 className="text-2xl font-semibold">Accounts</h1>
        <div className="flex flex-wrap gap-2">
          <a className="btn-secondary" href={`/admin/clients/export${qs({ page: 1 })}`} download>
            Export CSV
          </a>
        </div>
      </div>
      <Tabs view="app" />
      <p className="mb-6 text-sm text-[var(--muted)]">
        Every business (and individual) with their contacts and applications. Each links to its Salesforce Account and Lead Alchemist Company.
      </p>
      {duplicates > 0 && filter !== "review" && (
        <p className="mb-4 rounded-lg border border-[var(--notice-border)] bg-[var(--notice-bg)] p-3 text-sm" role="status">
          {duplicates} new account{duplicates === 1 ? " shares its" : "s share their"} name with an existing one.{" "}
          <Link className="btn-link" href="/admin/clients/duplicates">Review duplicates</Link>
        </p>
      )}

      {ghlMessage && <p className="callout mb-4 text-sm" role="status">{ghlMessage}</p>}
      <form action={searchClientsAction} className="card mb-6 flex flex-wrap items-center gap-3 !p-4" role="search">
        <label className="sr-only" htmlFor="q">Search accounts</label>
        <div className="flex w-full gap-3">
          <input id="q" name="q" defaultValue={q} className="input flex-1 !py-3 !text-lg" placeholder="Name, business, email or phone" />
          <button className="btn-primary">Search</button>
        </div>
        <label className="sr-only" htmlFor="filter">Show</label>
        <select id="filter" name="filter" defaultValue={filter} className="input !w-auto">
          {FILTERS.map((f) => (
            <option key={f.value} value={f.value}>{f.label}</option>
          ))}
        </select>
        <label className="sr-only" htmlFor="type">Account Type</label>
        <select id="type" name="type" defaultValue={type} className="input !w-auto" title="The Salesforce Account Type (the same value is Account Type and Contact Type in Lead Alchemist)">
          <option value="">All Account Types</option>
          {types.map((t) => (
            <option key={t} value={t}>{t}</option>
          ))}
          <option value={NO_ACCOUNT_TYPE}>No Account Type</option>
        </select>
        <label className="sr-only" htmlFor="source">Source</label>
        <select id="source" name="source" defaultValue={source} className="input !w-auto" title="Where the account first came into AIS Connect">
          <option value="">All sources</option>
          {(Object.keys(RECORD_SOURCE_LABEL) as RecordSource[]).map((k) => (
            <option key={k} value={k}>{RECORD_SOURCE_LABEL[k]}</option>
          ))}
        </select>
        <label className="sr-only" htmlFor="sort">Sort</label>
        <select id="sort" name="sort" defaultValue={sort} className="input !w-auto">
          {SORTS.map((s) => (
            <option key={s.value} value={s.value}>{s.label}</option>
          ))}
        </select>
        {q && (
          <button className="btn-secondary" name="clear" value="1" title="Show every account">
            Clear
          </button>
        )}
      </form>

      <ListSummary total={total} state={paging} noun="account" />
      <div className="card overflow-x-auto !p-0">
        <table className="data-table">
          <thead>
            <tr>
              <th>Account</th>
              <th>Primary contact</th>
              <th>Phone</th>
              <th>Contacts</th>
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
                  {c.isIndividual && <span className="badge badge-neutral ml-1">Individual</span>}
                  {c.sfAccountType && <span className="badge badge-neutral ml-1" title="Salesforce Account Type">{c.sfAccountType}</span>}
                  {c.possibleDuplicateOf && <span className="badge badge-warning ml-1" title="Shares its name with another account">Possible duplicate</span>}
                  <div className="text-xs text-[var(--muted)]">Source: {RECORD_SOURCE_LABEL[c.source]}</div>
                </td>
                <td className="text-sm">
                  {c.contactName && c.contactName !== c.name ? c.contactName : null}
                  <div className="text-xs text-[var(--muted)]">{c.primaryEmail}</div>
                </td>
                <td className="whitespace-nowrap text-sm">{c.phone ?? "—"}</td>
                <td>{c.contacts}</td>
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
                <td className="text-sm">
                  {c.sfAccountId ? (
                    <a href={l.salesforce("Account", c.sfAccountId) ?? "#"} target="_blank" rel="noopener" title="Open the Account in Salesforce" className="hover:opacity-80">
                      <SalesforceBadge status={c.sfStatus} />
                    </a>
                  ) : (
                    <SalesforceBadge status={c.sfStatus} />
                  )}
                  {c.sfAccountId && (
                    <div>
                      <SystemLink className="btn-link text-xs" href={l.salesforce("Account", c.sfAccountId)} missing="">Account</SystemLink>
                      {" · "}
                      <SystemLink className="btn-link text-xs" href={c.sfContactId ? l.salesforce("Contact", c.sfContactId) : null} missing="No contact on this account is linked to a Salesforce Contact yet">
                        {c.sfContactId ? "Contact" : "Contact not linked"}
                      </SystemLink>
                    </div>
                  )}
                </td>
                <td className="text-sm">
                  <SystemLink title={LA_COMPANY_HINT} className="btn-link" href={l.ghlCompany(c.ghlCompanyId)} missing="No Lead Alchemist Company yet (Settings → Data mapping)">
                    {c.ghlCompanyId ? "Company" : "No Company"}
                  </SystemLink>
                  <div>
                    <SystemLink className="btn-link text-xs" href={l.ghlContact(c.ghlContactId)} missing="Primary contact not linked to Lead Alchemist yet">
                      {c.ghlContactId ? "Contact" : "Contact not linked"}
                    </SystemLink>
                  </div>
                </td>
              </tr>
            ))}
            {!rows.length && (
              <tr>
                <td colSpan={9} className="py-10 text-center text-[var(--muted)]">{q ? "No accounts match that search." : "No accounts yet."}</td>
              </tr>
            )}
          </tbody>
        </table>
      </div>
      <Pagination total={total} state={paging} noun="account" href={pageHref("/admin/clients", { sort, filter, type: type || undefined, source: source || undefined })} />
    </div>
  );
}
