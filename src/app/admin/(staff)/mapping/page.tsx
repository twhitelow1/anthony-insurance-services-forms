import Link from "next/link";
import { cookies } from "next/headers";
import { SystemLink } from "@/components/clients";
import { SelectAll } from "@/components/SelectAll";
import { requireStaff } from "@/lib/auth/session";
import { readFlash } from "@/lib/flash";
import { ghlConfig } from "@/lib/ghl/client";
import { links } from "@/lib/integrations/links";
import {
  accountTypesInApp,
  laCompaniesNotInSalesforce,
  listAccountMap,
  listContactMap,
  mapCounts,
  multiAccountContacts,
  NO_TYPE,
  type AccountMapFilter,
  type ContactMapFilter,
} from "@/lib/mapping/database";
import { salesforceConfig } from "@/lib/salesforce/config";
import { FlashMessage } from "../salesforce/ui";
import {
  accountsToLeadAlchemistAction,
  accountsToSalesforceAction,
  companiesToSalesforceAction,
  companyTagsAction,
  contactsToCompanyAction,
  contactsToLeadAlchemistAction,
  contactsToSalesforceAction,
  searchMappingAction,
} from "./actions";
import { MAP_SEARCH_COOKIE } from "./search-cookie";

export const metadata = { title: "Mapping | Anthony Insurance Services" };
export const dynamic = "force-dynamic";

const TABS = ["accounts", "contacts", "companies", "multi"] as const;
type Tab = (typeof TABS)[number];
const TAB_LABEL: Record<Tab, string> = {
  accounts: "Accounts",
  contacts: "Contacts",
  companies: "Lead Alchemist Companies",
  multi: "People at several companies",
};
const ACCOUNT_FILTERS: { value: AccountMapFilter; label: string }[] = [
  { value: "all", label: "All" },
  { value: "sf_not_la", label: "In Salesforce, not in Lead Alchemist" },
  { value: "la_not_sf", label: "In Lead Alchemist, not in Salesforce" },
  { value: "neither", label: "In neither" },
  { value: "both", label: "In both" },
];
const CONTACT_FILTERS: { value: ContactMapFilter; label: string }[] = [
  { value: "all", label: "All" },
  { value: "no_la", label: "Not linked to Lead Alchemist" },
  { value: "no_sf", label: "Not in Salesforce" },
  { value: "la_company_check", label: "Linked, account has a Company" },
];

const Yes = ({ on, label }: { on: boolean; label: string }) => (
  <span className={`badge ${on ? "badge-success" : "badge-neutral"}`}>{on ? label : "—"}</span>
);

export default async function Mapping({ searchParams }: PageProps<"/admin/mapping">) {
  await requireStaff("/admin/mapping");
  const sp = await searchParams;
  const str = (k: string) => (typeof sp[k] === "string" ? (sp[k] as string) : "");
  const tab: Tab = TABS.includes(str("tab") as Tab) ? (str("tab") as Tab) : "accounts";
  const page = Math.max(1, Number(str("page")) || 1);
  const type = str("type").slice(0, 80);
  const q = (await cookies()).get(MAP_SEARCH_COOKIE)?.value ?? "";
  const flash = await readFlash(sp.f);
  const [l, counts, laOn, sfOn, types] = await Promise.all([links(), mapCounts(), ghlConfig(), salesforceConfig(), accountTypesInApp()]);

  const accountFilter = ACCOUNT_FILTERS.some((f) => f.value === str("filter")) ? (str("filter") as AccountMapFilter) : "all";
  const contactFilter = CONTACT_FILTERS.some((f) => f.value === str("filter")) ? (str("filter") as ContactMapFilter) : "all";
  const qs = (over: Record<string, string | number>) => {
    const p = new URLSearchParams({ tab, ...(str("filter") ? { filter: str("filter") } : {}), ...(type ? { type } : {}) });
    for (const [k, v] of Object.entries(over)) {
      if (v === "" || v === 0) p.delete(k);
      else p.set(k, String(v));
    }
    return `?${p}`;
  };
  const back = `/admin/mapping${qs({ page: page > 1 ? page : 0 })}`;

  let laError: string | null = null;
  const accounts = tab === "accounts" ? await listAccountMap({ q, filter: accountFilter, page, type: type || null }) : null;
  const contacts = tab === "contacts" ? await listContactMap({ q, filter: contactFilter, page }) : null;
  let companies: Awaited<ReturnType<typeof laCompaniesNotInSalesforce>> = [];
  if (tab === "companies" && laOn) {
    try {
      companies = await laCompaniesNotInSalesforce(q);
    } catch (err) {
      laError = err instanceof Error ? err.message : String(err);
    }
  }
  const multi = tab === "multi" ? await multiAccountContacts() : [];
  const pages = (total: number, size: number) => Math.max(1, Math.ceil(total / size));

  return (
    <div>
      <h1 className="mb-2 text-2xl font-semibold">Mapping</h1>
      <p className="mb-4 max-w-3xl text-sm text-[var(--muted)]">
        Every account and contact in this app with its Salesforce and Lead Alchemist links. Filter to what isn&apos;t mapped yet, tick rows and send
        them across. Nothing runs on its own and nothing is deleted anywhere; records are linked when one already matches, and created otherwise.
      </p>
      <p className="mb-4 text-sm">
        <strong>{counts.accounts}</strong> accounts: <strong>{counts.sfNotLa}</strong> in Salesforce only · <strong>{counts.laNotSf}</strong> in Lead
        Alchemist only · <strong>{counts.neither}</strong> in neither. <strong>{counts.contacts}</strong> contacts: <strong>{counts.contactsNoLa}</strong>{" "}
        not linked to Lead Alchemist · <strong>{counts.contactsNoSf}</strong> not in Salesforce.
      </p>
      <FlashMessage flash={flash} />

      <nav className="mb-4 flex flex-wrap gap-2" aria-label="Lists">
        {TABS.map((t) => (
          <Link key={t} href={`?tab=${t}`} className={t === tab ? "btn-primary" : "btn-secondary"} aria-current={t === tab ? "page" : undefined}>
            {TAB_LABEL[t]}
          </Link>
        ))}
      </nav>

      <div className="card mb-4 flex flex-wrap items-end gap-3 !p-4">
        <form action={searchMappingAction} className="flex flex-1 flex-wrap gap-3" role="search">
          <input type="hidden" name="back" value={back} />
          <label className="sr-only" htmlFor="q">Search</label>
          <input id="q" name="q" defaultValue={q} className="input min-w-[12rem] flex-1" placeholder="Name, email or phone" />
          <button className="btn-primary">Search</button>
          {q && (
            <button name="clear" value="1" className="btn-secondary">Clear</button>
          )}
        </form>
        {(tab === "accounts" || tab === "contacts") && (
          <form method="get" className="flex flex-wrap items-end gap-2">
            <input type="hidden" name="tab" value={tab} />
            <label className="text-sm">
              <span className="field-label !mb-1">Show</span>
              <select name="filter" defaultValue={tab === "accounts" ? accountFilter : contactFilter} className="input">
                {(tab === "accounts" ? ACCOUNT_FILTERS : CONTACT_FILTERS).map((f) => (
                  <option key={f.value} value={f.value}>{f.label}</option>
                ))}
              </select>
            </label>
            {tab === "accounts" && (
              <label className="text-sm">
                <span className="field-label !mb-1">Salesforce Account Type</span>
                <select name="type" defaultValue={type} className="input">
                  <option value="">All types</option>
                  {types.map((t) => (
                    <option key={t} value={t}>{t}</option>
                  ))}
                  <option value={NO_TYPE}>No type</option>
                </select>
              </label>
            )}
            <button className="btn-secondary">Filter</button>
          </form>
        )}
      </div>

      {tab === "accounts" && accounts && (
        <>
          <form id="bulk" className="mb-3 flex flex-wrap gap-2 text-sm">
            <input type="hidden" name="back" value={back} />
            <button formAction={accountsToLeadAlchemistAction} className="btn-primary" disabled={!laOn} title={laOn ? undefined : "Connect Lead Alchemist first"}>
              Sync selected to Lead Alchemist Companies
            </button>
            <button formAction={accountsToSalesforceAction} className="btn-secondary" disabled={!sfOn} title={sfOn ? undefined : "Connect Salesforce first"}>
              Link or create selected in Salesforce
            </button>
          </form>
          <div className="overflow-x-auto">
            <table className="data-table">
              <thead>
                <tr>
                  <th className="w-8"><SelectAll form="bulk" /></th>
                  <th>Account</th>
                  <th>Type (Salesforce)</th>
                  <th>Salesforce</th>
                  <th>Lead Alchemist Company</th>
                  <th>Contacts in Lead Alchemist</th>
                </tr>
              </thead>
              <tbody>
                {!accounts.rows.length && (
                  <tr><td colSpan={6} className="text-[var(--muted)]">Nothing matches.</td></tr>
                )}
                {accounts.rows.map((a) => (
                  <tr key={a.id}>
                    <td><input type="checkbox" name="ids" value={a.id} form="bulk" aria-label={`Select ${a.name}`} /></td>
                    <td>
                      <Link className="btn-link font-medium" href={`/admin/clients/${a.id}`}>{a.name}</Link>
                      <div className="text-xs text-[var(--muted)]">
                        {a.isIndividual ? "Individual" : "Business"} · {a.apps} application{a.apps === 1 ? "" : "s"}
                      </div>
                    </td>
                    <td>{a.sfAccountType ? <span className="badge badge-neutral">{a.sfAccountType}</span> : <span className="text-[var(--muted)]">—</span>}</td>
                    <td>
                      {a.sfAccountId ? (
                        <SystemLink className="btn-link text-sm" href={l.salesforce("Account", a.sfAccountId)} missing="">
                          {a.sfSyncPaused ? "Linked (unsynced)" : "Linked"}
                        </SystemLink>
                      ) : (
                        <Yes on={false} label="" />
                      )}
                    </td>
                    <td>
                      {a.ghlCompanyId ? (
                        <SystemLink className="btn-link text-sm" href={l.ghlCompany(a.ghlCompanyId)} missing="">Linked</SystemLink>
                      ) : (
                        <Yes on={false} label="" />
                      )}
                    </td>
                    <td className="text-sm">
                      {a.inLa} of {a.people}
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
          <Pager page={page} pages={pages(accounts.total, accounts.pageSize)} qs={qs} />
        </>
      )}

      {tab === "contacts" && contacts && (
        <>
          <form id="bulk" className="mb-3 flex flex-wrap gap-2 text-sm">
            <input type="hidden" name="back" value={back} />
            <button formAction={contactsToLeadAlchemistAction} className="btn-primary" disabled={!laOn}>Link selected to Lead Alchemist (exact email/phone)</button>
            <button formAction={contactsToCompanyAction} className="btn-secondary" disabled={!laOn}>Add selected to their account&apos;s Company</button>
            <button formAction={contactsToSalesforceAction} className="btn-secondary" disabled={!sfOn}>Link or create selected in Salesforce</button>
          </form>
          <div className="overflow-x-auto">
            <table className="data-table">
              <thead>
                <tr>
                  <th className="w-8"><SelectAll form="bulk" /></th>
                  <th>Contact</th>
                  <th>Account</th>
                  <th>Salesforce</th>
                  <th>Lead Alchemist</th>
                </tr>
              </thead>
              <tbody>
                {!contacts.rows.length && (
                  <tr><td colSpan={5} className="text-[var(--muted)]">Nothing matches.</td></tr>
                )}
                {contacts.rows.map(({ contact: p, accountName, accountCompany }) => (
                  <tr key={p.id}>
                    <td><input type="checkbox" name="ids" value={p.id} form="bulk" aria-label={`Select ${p.name}`} /></td>
                    <td>
                      <span className="font-medium">{p.name}</span>
                      <div className="text-xs text-[var(--muted)]">{[p.primaryEmail, p.phones[0]].filter(Boolean).join(" · ")}</div>
                    </td>
                    <td>
                      <Link className="btn-link text-sm" href={`/admin/clients/${p.clientId}`}>{accountName}</Link>
                      {accountCompany && <div className="text-xs text-[var(--muted)]">Has a Company</div>}
                    </td>
                    <td>
                      {p.sfContactId ? (
                        <SystemLink className="btn-link text-sm" href={l.salesforce("Contact", p.sfContactId)} missing="">Linked</SystemLink>
                      ) : (
                        <Yes on={false} label="" />
                      )}
                    </td>
                    <td>
                      {p.ghlContactId ? (
                        <SystemLink className="btn-link text-sm" href={l.ghlContact(p.ghlContactId)} missing="">Linked</SystemLink>
                      ) : (
                        <Yes on={false} label="" />
                      )}
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
          <Pager page={page} pages={pages(contacts.total, contacts.pageSize)} qs={qs} />
        </>
      )}

      {tab === "companies" && (
        <>
          {!laOn ? (
            <p className="callout callout-notice">Connect Lead Alchemist in Settings → Integrations first.</p>
          ) : laError ? (
            <p className="rounded-lg bg-[var(--danger-bg)] p-3 text-sm text-[var(--danger)]" role="alert">
              Couldn&apos;t read Lead Alchemist Companies: {laError}. The token needs the Businesses (view, edit) scopes.
            </p>
          ) : (
            <>
              <form id="bulk" className="mb-3 flex flex-wrap items-center gap-2 text-sm">
                <input type="hidden" name="back" value={back} />
                <button formAction={companiesToSalesforceAction} className="btn-primary" disabled={!sfOn}>Link or create selected in Salesforce</button>
                <span className="text-[var(--muted)]">Lead Alchemist Companies with no Salesforce Account yet ({companies.length}).</span>
              </form>
              <div className="overflow-x-auto">
                <table className="data-table">
                  <thead>
                    <tr>
                      <th className="w-8"><SelectAll form="bulk" /></th>
                      <th>Company</th>
                      <th>In this app</th>
                      <th />
                    </tr>
                  </thead>
                  <tbody>
                    {!companies.length && (
                      <tr><td colSpan={4} className="text-[var(--muted)]">Every Company is linked to Salesforce.</td></tr>
                    )}
                    {companies.slice(0, 500).map(({ business: b, account }) => (
                      <tr key={b.id}>
                        <td><input type="checkbox" name="ids" value={b.id} form="bulk" aria-label={`Select ${b.name}`} /></td>
                        <td>
                          <span className="font-medium">{b.name}</span>
                          <div className="text-xs text-[var(--muted)]">{[b.email, b.phone, b.city].filter(Boolean).join(" · ")}</div>
                        </td>
                        <td>{account ? <Link className="btn-link text-sm" href={`/admin/clients/${account.id}`}>{account.name}</Link> : "—"}</td>
                        <td>
                          <SystemLink className="btn-link text-sm" href={l.ghlCompany(b.id)} missing="">View in Lead Alchemist</SystemLink>
                        </td>
                      </tr>
                    ))}
                  </tbody>
                </table>
              </div>
            </>
          )}
        </>
      )}

      {tab === "multi" && (
        <>
          <p className="mb-3 max-w-3xl text-sm text-[var(--muted)]">
            People tied to more than one account. Lead Alchemist keeps a contact in one Company, so they stay in their main account&apos;s Company and
            each other company is added to them as a &quot;company: name&quot; tag. Nothing is moved.
          </p>
          <form id="bulk" className="mb-3 flex flex-wrap gap-2 text-sm">
            <input type="hidden" name="back" value={back} />
            <button formAction={companyTagsAction} className="btn-primary" disabled={!laOn}>Add company tags in Lead Alchemist for selected</button>
          </form>
          <div className="overflow-x-auto">
            <table className="data-table">
              <thead>
                <tr>
                  <th className="w-8"><SelectAll form="bulk" /></th>
                  <th>Person</th>
                  <th>Accounts</th>
                  <th>Lead Alchemist</th>
                </tr>
              </thead>
              <tbody>
                {!multi.length && (
                  <tr><td colSpan={4} className="text-[var(--muted)]">Nobody is tied to more than one account yet.</td></tr>
                )}
                {multi.map(({ contact: p, accounts: accts }) => (
                  <tr key={p.id}>
                    <td><input type="checkbox" name="ids" value={p.id} form="bulk" aria-label={`Select ${p.name}`} /></td>
                    <td>
                      <span className="font-medium">{p.name}</span>
                      <div className="text-xs text-[var(--muted)]">{p.primaryEmail}</div>
                    </td>
                    <td className="text-sm">
                      {accts.map((a) => (
                        <div key={a.id}>
                          <Link className="btn-link" href={`/admin/clients/${a.id}`}>{a.name}</Link>
                          {a.home && <span className="badge badge-neutral ml-1">Main</span>}
                        </div>
                      ))}
                    </td>
                    <td>
                      {p.ghlContactId ? (
                        <SystemLink className="btn-link text-sm" href={l.ghlContact(p.ghlContactId)} missing="">Linked</SystemLink>
                      ) : (
                        <span className="text-xs text-[var(--muted)]">Not linked</span>
                      )}
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        </>
      )}
    </div>
  );
}

function Pager({ page, pages, qs }: { page: number; pages: number; qs: (o: Record<string, string | number>) => string }) {
  if (pages <= 1) return null;
  return (
    <div className="mt-4 flex items-center gap-3 text-sm">
      {page > 1 && <Link className="btn-secondary" href={qs({ page: page - 1 })}>← Previous</Link>}
      <span>
        Page {page} of {pages}
      </span>
      {page < pages && <Link className="btn-secondary" href={qs({ page: page + 1 })}>Next →</Link>}
    </div>
  );
}
