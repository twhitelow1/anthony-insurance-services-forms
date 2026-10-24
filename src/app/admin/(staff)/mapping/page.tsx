import Link from "next/link";
import { cookies } from "next/headers";
import { SystemLink, LA_COMPANY_HINT } from "@/components/clients";
import { ListSummary, pageHref, pageOf, pageState, Pagination } from "@/components/Pagination";
import { SelectAll } from "@/components/SelectAll";
import { SelectAllMatching } from "@/components/SelectAllMatching";
import { SelectionRunPanel } from "@/components/SelectionRunPanel";
import { getSelectionRun, showSelectionRun } from "@/lib/bulk/selection-run";
import { SubmitButton } from "@/components/SubmitButton";
import { AutoSubmit } from "@/components/AutoSubmit";
import { laMatchProgress } from "@/lib/mapping/la-matches";
import { requireStaff } from "@/lib/auth/session";
import { readFlash } from "@/lib/flash";
import { ghlConfig } from "@/lib/ghl/client";
import { links } from "@/lib/integrations/links";
import {
  accountTypesInApp,
  listCompanyMatches,
  listAccountMap,
  listContactMap,
  mapCounts,
  countMultiAccountContacts,
  multiAccountContacts,
  NO_TYPE,
  type AccountMapFilter,
  type ContactMapFilter,
} from "@/lib/mapping/database";
import type { CompanyFilter } from "@/lib/mapping/company-match";
import { salesforceConfig } from "@/lib/salesforce/config";
import { FlashMessage } from "../salesforce/ui";
import {
  accountsToLeadAlchemistAction,
  accountsToSalesforceAction,
  addCompaniesToAppAction,
  companiesToSalesforceAction,
  companyTagsAction,
  contactsToCompanyAction,
  contactsToSalesforceAction,
  linkCompaniesAction,
  findLaMatchesAction,
  searchMappingAction,
  stepMappingRunAction,
  stopMappingRunAction,
} from "./actions";
import { MAP_SEARCH_COOKIE } from "./search-cookie";

export const metadata = { title: "Mapping | AIS Connect" };
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
  { value: "la_suggested", label: "Has suggested Lead Alchemist contacts" },
];
const CONTACT_FILTERS: { value: ContactMapFilter; label: string }[] = [
  { value: "all", label: "All" },
  { value: "no_la", label: "Not linked to Lead Alchemist" },
  { value: "no_sf", label: "Not in Salesforce" },
  { value: "la_company_check", label: "Linked, account has a Company" },
  { value: "la_suggested", label: "Suggested Lead Alchemist match" },
];

const COMPANY_FILTERS: { value: CompanyFilter; label: string }[] = [
  { value: "unlinked", label: "Not linked yet" },
  { value: "strong", label: "Likely match (same name, website, phone or email domain)" },
  { value: "possible", label: "Possible match (similar name)" },
  { value: "none", label: "No match in AIS Connect" },
  { value: "linked", label: "Linked" },
  { value: "all", label: "All" },
];

const Yes = ({ on, label }: { on: boolean; label: string }) => (
  <span className={`badge ${on ? "badge-success" : "badge-neutral"}`}>{on ? label : "—"}</span>
);

export default async function Mapping({ searchParams }: PageProps<"/admin/mapping">) {
  await requireStaff("/admin/mapping");
  const sp = await searchParams;
  const str = (k: string) => (typeof sp[k] === "string" ? (sp[k] as string) : "");
  const tab: Tab = TABS.includes(str("tab") as Tab) ? (str("tab") as Tab) : "accounts";
  const paging = pageState(sp, 100);
  const { page } = paging;
  const type = str("type").slice(0, 80);
  const q = (await cookies()).get(MAP_SEARCH_COOKIE)?.value ?? "";
  const flash = await readFlash(sp.f);
  const matching = str("matching") === "1";
  const [l, counts, laOn, sfOn, types, selectionRun] = await Promise.all([links(), mapCounts(), ghlConfig(), salesforceConfig(), accountTypesInApp(), getSelectionRun("mapping")]);
  const runActive = selectionRun?.phase === "running";

  const accountFilter = ACCOUNT_FILTERS.some((f) => f.value === str("filter")) ? (str("filter") as AccountMapFilter) : "all";
  const companyFilter = COMPANY_FILTERS.some((f) => f.value === str("filter")) ? (str("filter") as CompanyFilter) : "unlinked";
  const contactFilter = CONTACT_FILTERS.some((f) => f.value === str("filter")) ? (str("filter") as ContactMapFilter) : "all";
  const qs = (over: Record<string, string | number>) => {
    const p = new URLSearchParams({ tab, ...(str("filter") ? { filter: str("filter") } : {}), ...(type ? { type } : {}) });
    for (const [k, v] of Object.entries(over)) {
      if (v === "" || v === 0) p.delete(k);
      else p.set(k, String(v));
    }
    return `?${p}`;
  };
  const back = `/admin/mapping${qs({ page: page > 1 ? page : 0, size: paging.pageSize !== 100 ? paging.pageSize : 0 })}`;
  const href = pageHref("/admin/mapping", { tab, filter: str("filter") || undefined, type: type || undefined }, 100);

  let laError: string | null = null;
  const matchProgress = laOn && (tab === "accounts" || tab === "contacts") ? await laMatchProgress() : null;
  const accounts = tab === "accounts" ? await listAccountMap({ q, filter: accountFilter, page, type: type || null, pageSize: paging.pageSize }) : null;
  const contacts = tab === "contacts" ? await listContactMap({ q, filter: contactFilter, page, pageSize: paging.pageSize }) : null;
  let companies: Awaited<ReturnType<typeof listCompanyMatches>> | null = null;
  if (tab === "companies" && laOn) {
    try {
      companies = await listCompanyMatches({ q, filter: companyFilter });
    } catch (err) {
      laError = err instanceof Error ? err.message : String(err);
    }
  }
  const [multi, multiTotal] = tab === "multi" ? await Promise.all([multiAccountContacts(paging.pageSize, paging.offset), countMultiAccountContacts()]) : [[], 0];
  const companyRows = companies ? pageOf(companies.rows, paging) : [];

  return (
    <div>
      <h1 className="mb-2 text-2xl font-semibold">Mapping</h1>
      <p className="mb-4 max-w-3xl text-sm text-[var(--muted)]">
        Every account and contact in AIS Connect with its Salesforce and Lead Alchemist links. Filter to what isn&apos;t mapped yet, tick rows and send
        them across. Nothing runs on its own and nothing is deleted anywhere; records are linked when one already matches, and created otherwise.
      </p>
      <p className="mb-4 text-sm">
        <strong>{counts.accounts}</strong> accounts: <strong>{counts.sfNotLa}</strong> in Salesforce only · <strong>{counts.laNotSf}</strong> in Lead
        Alchemist only · <strong>{counts.neither}</strong> in neither. <strong>{counts.contacts}</strong> contacts: <strong>{counts.contactsNoLa}</strong>{" "}
        not linked to Lead Alchemist · <strong>{counts.contactsNoSf}</strong> not in Salesforce.
      </p>
      <FlashMessage flash={flash} />
      {showSelectionRun(selectionRun) && <SelectionRunPanel run={selectionRun} back={back} stepAction={stepMappingRunAction} stopAction={stopMappingRunAction} />}

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
        {tab === "companies" && (
          <form method="get" className="flex flex-wrap items-end gap-2">
            <input type="hidden" name="tab" value={tab} />
            <label className="text-sm">
              <span className="field-label !mb-1">Show</span>
              <select name="filter" defaultValue={companyFilter} className="input">
                {COMPANY_FILTERS.map((f) => (
                  <option key={f.value} value={f.value}>{f.label}</option>
                ))}
              </select>
            </label>
            <button className="btn-secondary">Filter</button>
          </form>
        )}
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

      {matchProgress && <LaMatchPanel progress={matchProgress} matching={matching} back={back} />}

      {tab === "accounts" && accounts && (
        <>
          <form id="bulk" className="mb-3 flex flex-wrap gap-2 text-sm">
            <input type="hidden" name="back" value={back} />
            <SubmitButton formAction={accountsToLeadAlchemistAction} className="btn-primary" disabled={!laOn} title={laOn ? undefined : "Connect Lead Alchemist first"}>
              Sync selected to Lead Alchemist (Company + contacts)
            </SubmitButton>
            <SubmitButton formAction={accountsToSalesforceAction} className="btn-secondary" disabled={!sfOn} title={sfOn ? undefined : "Connect Salesforce first"}>
              Link or create selected in Salesforce
            </SubmitButton>
            <label className="flex items-center gap-2" title="Lead Alchemist may start its workflows for new contacts">
              <input type="checkbox" name="createMissing" value="yes" /> Create missing contacts in Lead Alchemist
            </label>
          </form>
          {!runActive && <SelectAllMatching form="bulk" onPage={accounts.rows.length} total={accounts.total} noun="accounts" />}
          <ListSummary total={accounts.total} state={paging} noun="account" />
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
                        <SystemLink title={LA_COMPANY_HINT} className="btn-link text-sm" href={l.ghlCompany(a.ghlCompanyId)} missing="">Linked</SystemLink>
                      ) : (
                        <Yes on={false} label="" />
                      )}
                    </td>
                    <td className="text-sm">
                      {a.inLa} of {a.people}
                      {a.laSuggested > 0 && <div className="text-xs"><span className="badge badge-warning">{a.laSuggested} suggested</span></div>}
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
          <Pagination total={accounts.total} state={paging} noun="account" href={href} />
        </>
      )}

      {tab === "contacts" && contacts && (
        <>
          <form id="bulk" className="mb-3 flex flex-wrap gap-2 text-sm">
            <input type="hidden" name="back" value={back} />
            <SubmitButton formAction={contactsToCompanyAction} className="btn-primary" disabled={!laOn} title="Links by exact email or phone, then adds each to their account's Company">
              Sync selected to Lead Alchemist (and their Company)
            </SubmitButton>
            <SubmitButton formAction={contactsToSalesforceAction} className="btn-secondary" disabled={!sfOn}>Link or create selected in Salesforce</SubmitButton>
            <label className="flex items-center gap-2" title="Lead Alchemist may start its workflows for new contacts">
              <input type="checkbox" name="createMissing" value="yes" /> Create missing contacts in Lead Alchemist
            </label>

          </form>
          {!runActive && <SelectAllMatching form="bulk" onPage={contacts.rows.length} total={contacts.total} noun="contacts" />}
          <ListSummary total={contacts.total} state={paging} noun="contact" />
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
                      ) : p.laMatchId ? (
                        <div className="text-xs">
                          <span className="badge badge-warning">Suggested</span>{" "}
                          <SystemLink className="btn-link" href={l.ghlContact(p.laMatchId)} missing="">{p.laMatchName ?? "Lead Alchemist contact"}</SystemLink>
                          <div className="text-[var(--muted)]">same {p.laMatchHow?.replace("+", " and ")}</div>
                        </div>
                      ) : p.laMatchHow === "several" ? (
                        <span className="badge badge-neutral" title="More than one Lead Alchemist contact has this email or phone: pick one on the Salesforce Account page">Several matches</span>
                      ) : (
                        <Yes on={false} label="" />
                      )}
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
          <Pagination total={contacts.total} state={paging} noun="contact" href={href} />
        </>
      )}

      {tab === "companies" && (
        <>
          {!laOn ? (
            <p className="callout callout-notice">Connect Lead Alchemist in Settings → Integrations first.</p>
          ) : laError ? (
            <p className="rounded-lg bg-[var(--danger-bg)] p-3 text-sm text-[var(--danger)]" role="alert">
              Couldn&apos;t read Lead Alchemist Companies: {laError}
            </p>
          ) : companies ? (
            <>
              <p className="mb-2 text-sm">
                <strong>{companies.counts.total}</strong> Companies in Lead Alchemist: <strong>{companies.counts.linked}</strong> linked ·{" "}
                <strong>{companies.counts.strong}</strong> likely match · <strong>{companies.counts.possible}</strong> possible match ·{" "}
                <strong>{companies.counts.none}</strong> no match in AIS Connect.
              </p>
              <p className="mb-3 max-w-3xl text-sm text-[var(--muted)]">
                Matched against every account in AIS Connect (which mirrors Salesforce once its Accounts are synced). Check the account picked in each
                row, tick the rows and link them. Linking only saves the pairing in AIS Connect; nothing changes in Lead Alchemist or Salesforce.
              </p>
              <form id="bulk" className="mb-3 flex flex-wrap items-center gap-2 text-sm">
                <input type="hidden" name="back" value={back} />
                <SubmitButton formAction={linkCompaniesAction} className="btn-primary">Link selected to the chosen account</SubmitButton>
                <SubmitButton formAction={addCompaniesToAppAction} className="btn-secondary">Add selected to AIS Connect as new accounts</SubmitButton>
                <SubmitButton formAction={companiesToSalesforceAction} className="btn-secondary" disabled={!sfOn}>Link or create selected in Salesforce</SubmitButton>
              </form>
              {!runActive && <SelectAllMatching form="bulk" onPage={companyRows.length} total={companies.rows.length} noun="Companies" />}
              <ListSummary total={companies.rows.length} state={paging} noun="Company" />
              <div className="overflow-x-auto">
                <table className="data-table">
                  <thead>
                    <tr>
                      <th className="w-8"><SelectAll form="bulk" /></th>
                      <th>Lead Alchemist Company</th>
                      <th>Account in AIS Connect</th>
                      <th>Salesforce</th>
                      <th />
                    </tr>
                  </thead>
                  <tbody>
                    {!companies.rows.length && (
                      <tr><td colSpan={5} className="text-[var(--muted)]">No Companies in this list.</td></tr>
                    )}
                    {companyRows.map(({ business: b, linked, suggestions }) => {
                      const shown = linked ?? suggestions[0]?.account ?? null;
                      return (
                        <tr key={b.id}>
                          <td><input type="checkbox" name="ids" value={b.id} form="bulk" aria-label={`Select ${b.name}`} /></td>
                          <td>
                            <span className="font-medium">{b.name}</span>
                            <div className="text-xs text-[var(--muted)]">{[b.email, b.phone, b.website, b.city].filter(Boolean).join(" · ")}</div>
                          </td>
                          <td>
                            {linked ? (
                              <>
                                <Link className="btn-link text-sm" href={`/admin/clients/${linked.id}`}>{linked.name}</Link> <span className="badge badge-success">Linked</span>
                              </>
                            ) : suggestions.length ? (
                              <select name={`match_${b.id}`} form="bulk" defaultValue={suggestions[0].account.id} className="input max-w-[22rem] text-sm" aria-label={`Account for ${b.name}`}>
                                {suggestions.map((m) => (
                                  <option key={m.account.id} value={m.account.id}>
                                    {m.confidence === "strong" ? "Likely" : "Possible"}: {m.account.name} ({m.why.join(", ")})
                                  </option>
                                ))}
                                <option value="">None of these</option>
                              </select>
                            ) : (
                              <span className="text-[var(--muted)]">No match</span>
                            )}
                          </td>
                          <td>
                            {shown?.sfAccountId ? (
                              <>
                                <SystemLink className="btn-link text-sm" href={l.salesforce("Account", shown.sfAccountId)} missing="">In Salesforce</SystemLink>
                                {shown.sfAccountType && <span className="badge badge-neutral ml-1">{shown.sfAccountType}</span>}
                              </>
                            ) : (
                              <span className="text-[var(--muted)]">—</span>
                            )}
                          </td>
                          <td>
                            <SystemLink title={LA_COMPANY_HINT} className="btn-link text-sm" href={l.ghlCompany(b.id)} missing="">View in Lead Alchemist</SystemLink>
                          </td>
                        </tr>
                      );
                    })}
                  </tbody>
                </table>
              </div>
              <Pagination total={companies.rows.length} state={paging} noun="Company" href={href} />
            </>
          ) : null}
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
            <SubmitButton formAction={companyTagsAction} className="btn-primary" disabled={!laOn}>Add company tags in Lead Alchemist for selected</SubmitButton>
          </form>
          {!runActive && <SelectAllMatching form="bulk" onPage={multi.length} total={multiTotal} noun="people" />}
          <ListSummary total={multiTotal} state={paging} noun="person" />
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
          <Pagination total={multiTotal} state={paging} noun="person" href={href} />
        </>
      )}
    </div>
  );
}

/** Progress of "Find Lead Alchemist matches"; while `matching` and contacts are left, it continues on its own. */
function LaMatchPanel({ progress, matching, back }: { progress: Awaited<ReturnType<typeof laMatchProgress>>; matching: boolean; back: string }) {
  const running = matching && progress.remaining > 0;
  return (
    <form action={findLaMatchesAction} className="card mb-4 flex flex-wrap items-center gap-3 !p-4 text-sm">
      <input type="hidden" name="back" value={back} />
      <div className="min-w-[16rem] flex-1">
        <p className="font-semibold">Lead Alchemist matches for unlinked contacts</p>
        <p className="text-[var(--muted)]">
          Checked <strong>{progress.checked.toLocaleString("en-US")}</strong> of <strong>{progress.total.toLocaleString("en-US")}</strong> contacts not linked
          to Lead Alchemist · <strong>{progress.suggested.toLocaleString("en-US")}</strong> have one exact email or phone match (suggested)
          {progress.several ? <> · {progress.several.toLocaleString("en-US")} match several</> : null}. Reads Lead Alchemist only; filter by
          &quot;suggested&quot;, then tick and sync to link them.
        </p>
      </div>
      {running ? (
        <>
          <span>Checking… keep this page open.</span>
          <AutoSubmit label="Continue" />
          <Link className="btn-link" href={back}>Pause</Link>
        </>
      ) : progress.remaining > 0 ? (
        <SubmitButton className="btn-primary">{progress.checked ? `Continue (${progress.remaining.toLocaleString("en-US")} left)` : "Find Lead Alchemist matches"}</SubmitButton>
      ) : (
        <>
          <input type="hidden" name="recheck" value="yes" />
          <SubmitButton>Check all again</SubmitButton>
        </>
      )}
    </form>
  );
}
