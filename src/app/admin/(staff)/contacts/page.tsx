import Link from "next/link";
import { accountTypesAcross } from "@/lib/accounts/directory";
import { NO_ACCOUNT_TYPE } from "@/lib/clients/repo";
import { cookies } from "next/headers";
import { AutoSubmit } from "@/components/AutoSubmit";
import { SystemLink, LA_COMPANY_HINT } from "@/components/clients";
import { ListSummary, pageHref, pageState, Pagination } from "@/components/Pagination";
import { SelectAll } from "@/components/SelectAll";
import { SelectAllMatching } from "@/components/SelectAllMatching";
import { SelectionRunPanel } from "@/components/SelectionRunPanel";
import { getSelectionRun, showSelectionRun } from "@/lib/bulk/selection-run";
import { SubmitButton } from "@/components/SubmitButton";
import { requireStaff } from "@/lib/auth/session";
import { directoryBreakdown, directoryCounts, getImport, listDirectory, type CompanyState, type DirectoryFilter, type DirectoryImport, type DirectoryRow, type DirectorySource, type Presence } from "@/lib/contacts/directory";
import { readFlash } from "@/lib/flash";
import { ghlConfig } from "@/lib/ghl/client";
import { links } from "@/lib/integrations/links";
import { salesforceConfig } from "@/lib/salesforce/config";
import { FlashMessage } from "../salesforce/ui";
import {
  addToAppAction,
  importAction,
  searchContactsAction,
  sendToLeadAlchemistAction,
  sendToSalesforceAction,
  stepContactsRunAction,
  stopContactsRunAction,
  updateLaDetailsAction,
} from "./actions";
import { CONTACT_SEARCH_COOKIE } from "./search-cookie";

export const metadata = { title: "Contacts | AIS Connect" };
export const dynamic = "force-dynamic";

const FILTERS: { value: DirectoryFilter; label: string }[] = [
  { value: "all", label: "Any" },
  { value: "app_only", label: "Only in AIS Connect" },
  { value: "sf_only", label: "Only in Salesforce" },
  { value: "la_only", label: "Only in Lead Alchemist" },
  { value: "not_app", label: "Not in AIS Connect" },
  { value: "not_sf", label: "Not in Salesforce" },
  { value: "not_la", label: "Not in Lead Alchemist" },
  { value: "everywhere", label: "In all three" },
  { value: "la_outdated", label: "Lead Alchemist details missing or different" },
  { value: "possible_dup", label: "Possible duplicate (same name somewhere else)" },
];

const COMPANY_STATES: { value: CompanyState; label: string }[] = [
  { value: "linked", label: "Matched to a company" },
  { value: "suggested", label: "Suggested company (not linked yet)" },
  { value: "none", label: "No company match" },
];

const fmt = (n: number) => n.toLocaleString("en-US");

/** One-click combinations for the usual sweeps. */
const PRESETS: { label: string; params: Record<string, string> }[] = [
  { label: "Needs adding to Lead Alchemist", params: { app: "yes", la: "no" } },
  { label: "Customers not in Lead Alchemist", params: { type: "Customer", la: "no" } },
  { label: "In Salesforce, no AIS Connect account", params: { sf: "yes", account: "no" } },
  { label: "Needs adding to Salesforce", params: { app: "yes", sf: "no" } },
  { label: "Unmatched company", params: { company: "none" } },
  { label: "Lead Alchemist details differ", params: { filter: "la_outdated" } },
];

const SYSTEMS = [
  { key: "app", label: "AIS Connect" },
  { key: "sf", label: "Salesforce" },
  { key: "la", label: "Lead Alchemist" },
] as const;
type SystemKey = (typeof SYSTEMS)[number]["key"];
const yesNo = (v: string) => (v === "yes" || v === "no" ? v : undefined);

/** "In AIS Connect and Salesforce, not Lead Alchemist" */
function comboLabel(c: Record<SystemKey, boolean>) {
  const inSys = SYSTEMS.filter((s) => c[s.key]).map((s) => s.label);
  const outSys = SYSTEMS.filter((s) => !c[s.key]).map((s) => s.label);
  if (!outSys.length) return "In all three";
  if (inSys.length === 1) return `Only in ${inSys[0]}`;
  return `In ${inSys.join(" and ")}, not ${outSys[0]}`;
}
const Missing = () => <span className="badge badge-neutral">Not there</span>;

/** Their Lead Alchemist Company: the one they're in or their account is linked to, else a suggested match. */
function CompanyInfo({ r, companyHref }: { r: DirectoryRow; companyHref: (id: string) => string | null }) {
  if (r.company) {
    return (
      <div className="mt-1 text-xs">
        {r.inLa && r.laCompanyId === r.company.id ? "Company: " : "Account's Company: "}
        <SystemLink title={LA_COMPANY_HINT} className="btn-link" href={companyHref(r.company.id)} missing="">
          {r.company.name ?? r.laCompany ?? "Company"}
        </SystemLink>
      </div>
    );
  }
  if (r.suggestedCompany) {
    const byName = r.suggestedCompany.how === "same name";
    return (
      <div className="mt-1 text-xs">
        <span
          className={`badge ${byName ? "badge-success" : "badge-warning"}`}
          title={
            byName
              ? "Same name as their account: syncing joins this Company (no new one is made)"
              : "Same phone, different name: link it on the account page (or Mapping → Lead Alchemist Companies) before syncing, or syncing makes a new Company"
          }
        >
          Matching Company ({r.suggestedCompany.how}){byName ? ": sync uses it" : ": link before syncing"}
        </span>{" "}
        <SystemLink title={LA_COMPANY_HINT} className="btn-link" href={companyHref(r.suggestedCompany.id)} missing="">
          {r.suggestedCompany.name}
        </SystemLink>
      </div>
    );
  }
  return <div className="mt-1 text-xs text-[var(--muted)]">No Company found (syncing creates one)</div>;
}

export default async function Contacts({ searchParams }: PageProps<"/admin/contacts">) {
  await requireStaff("/admin/contacts");
  const sp = await searchParams;
  const str = (k: string) => (typeof sp[k] === "string" ? (sp[k] as string) : "");
  const filter = FILTERS.some((f) => f.value === str("filter")) ? (str("filter") as DirectoryFilter) : "all";
  const presence: Presence = { app: yesNo(str("app")), sf: yesNo(str("sf")), la: yesNo(str("la")) };
  const account = yesNo(str("account"));
  const company = COMPANY_STATES.find((c) => c.value === str("company"))?.value;
  const tier = str("tier") === "primary" || str("tier") === "secondary" ? (str("tier") as "primary" | "secondary") : undefined;
  const type = str("type").slice(0, 80) || undefined;
  const paging = pageState(sp);
  const q = (await cookies()).get(CONTACT_SEARCH_COOKIE)?.value ?? "";
  const importing = str("importing");
  const [flash, l, laOn, sfOn, counts, sfImport, laImport, list] = await Promise.all([
    readFlash(sp.f),
    links(),
    ghlConfig(),
    salesforceConfig(),
    directoryCounts(),
    getImport("salesforce"),
    getImport("lead_alchemist"),
    listDirectory({ q, filter, presence, account, company, tier, type, limit: paging.pageSize, offset: paging.offset }),
  ]);
  const [breakdown, selectionRun, types] = await Promise.all([directoryBreakdown(q), getSelectionRun("contacts"), accountTypesAcross()]);
  const runActive = selectionRun?.phase === "running";
  const params = { filter: filter !== "all" ? filter : undefined, app: presence.app, sf: presence.sf, la: presence.la, account, company, tier, type };
  const filterParams: Record<string, string | undefined> = params;
  const activeText = [
    ...SYSTEMS.filter((x) => presence[x.key]).map((x) => `${x.label} = ${presence[x.key] === "yes" ? "Yes" : "No"}`),
    account && `AIS Connect account = ${account === "yes" ? "Yes" : "No"}`,
    type && `Account Type = ${type === NO_ACCOUNT_TYPE ? "none" : type}`,
    tier && `Client tier = ${tier === "primary" ? "Primary" : "Secondary"}`,
    company && `Company match = ${COMPANY_STATES.find((c) => c.value === company)?.label}`,
    filter !== "all" && FILTERS.find((f) => f.value === filter)?.label,
    q && `matching "${q}"`,
  ]
    .filter(Boolean)
    .join(", ");
  const href = pageHref("/admin/contacts", params);
  const comboHref = (c: Record<SystemKey, boolean>) => `/admin/contacts?${new URLSearchParams({ app: c.app ? "yes" : "no", sf: c.sf ? "yes" : "no", la: c.la ? "yes" : "no" })}`;
  const isCombo = (c: Record<SystemKey, boolean>) => filter === "all" && !account && !company && !tier && !type && SYSTEMS.every((x) => presence[x.key] === (c[x.key] ? "yes" : "no"));
  const back = href(paging.page, paging.pageSize);

  return (
    <div>
      <h1 className="mb-2 text-2xl font-semibold">Contacts</h1>
      <p className="mb-4 max-w-3xl text-sm text-[var(--muted)]">
        Everyone in AIS Connect, Salesforce and Lead Alchemist, one row per person, with their Account in each place (Company in Lead Alchemist). People
        are matched by their saved links, then email, then phone. Filter to who&apos;s missing somewhere, tick them and sync. Nothing is deleted
        anywhere.
      </p>
      <FlashMessage flash={flash} />

      <div className="mb-4 grid gap-3 md:grid-cols-2">
        <ImportCard source="salesforce" label="Salesforce" connected={!!sfOn} count={counts.salesforce} run={sfImport} active={importing === "salesforce"} back={back} />
        <ImportCard source="lead_alchemist" label="Lead Alchemist" connected={!!laOn} count={counts.leadAlchemist} run={laImport} active={importing === "lead_alchemist"} back={back} />
      </div>

      <div className="mb-3 flex flex-wrap items-center gap-2 text-sm" aria-label="Presets">
        <span className="text-xs font-semibold uppercase tracking-wide text-[var(--muted)]">Quick filters</span>
        {PRESETS.map((p) => (
          <Link key={p.label} className="btn-secondary !px-3 !py-1 text-sm" href={`/admin/contacts?${new URLSearchParams(p.params)}`}>{p.label}</Link>
        ))}
      </div>

      <div className="mb-3 flex flex-wrap items-center gap-2 text-sm" aria-label="Where they exist">
        <span className="text-xs font-semibold uppercase tracking-wide text-[var(--muted)]">Where they exist</span>
        {SYSTEMS.map((x) => {
          const now = presence[x.key];
          const next = now === undefined ? "yes" : now === "yes" ? "no" : undefined;
          const params = Object.fromEntries(Object.entries({ ...filterParams, [x.key]: next }).filter(([, v]) => v !== undefined) as [string, string][]);
          return (
            <Link
              key={x.key}
              href={`/admin/contacts?${new URLSearchParams(params)}`}
              title={`Found in ${x.label}: ${now === "yes" ? "yes" : now === "no" ? "no" : "any"}. Click to change (yes, no, any).`}
              className={`rounded-full border px-3 py-1 font-medium ${now === "yes" ? "border-[var(--success)] bg-[var(--success-bg)] text-[var(--success)]" : now === "no" ? "border-[var(--danger)] bg-[var(--danger-bg)] text-[var(--danger)]" : "border-[var(--border)] bg-[var(--surface)]"}`}
            >
              {x.label} {now === "yes" ? "✓" : now === "no" ? "✗" : "· any"}
            </Link>
          );
        })}
      </div>

      <div className="card mb-4 flex flex-wrap items-end gap-3 !p-4">
        <form action={searchContactsAction} className="flex w-full flex-wrap gap-3" role="search">
          <input type="hidden" name="back" value={back} />
          <label className="sr-only" htmlFor="q">Search contacts</label>
          <input id="q" name="q" defaultValue={q} className="input min-w-[16rem] flex-1 !py-3 !text-lg" placeholder="Name, email, phone or business" />
          <button className="btn-primary">Search</button>
          {q && (
            <button name="clear" value="1" className="btn-secondary">Clear</button>
          )}
        </form>
        <form method="get" className="w-full space-y-3">
          {SYSTEMS.map((x) => presence[x.key] && <input key={x.key} type="hidden" name={x.key} value={presence[x.key]} />)}
          <fieldset className="flex flex-wrap items-end gap-3">
            <legend className="mb-1 text-xs font-semibold uppercase tracking-wide text-[var(--muted)]">Who they are</legend>
            <label className="text-sm" title="Whether their business has an account in AIS Connect: their own, or the one linked to their Salesforce Account or Lead Alchemist Company">
              <span className="field-label !mb-1">Has an AIS Connect account</span>
              <select name="account" defaultValue={account ?? ""} className="input">
                <option value="">Any</option>
                <option value="yes">Yes</option>
                <option value="no">No</option>
              </select>
            </label>
            <label className="text-sm" title="Their account's Salesforce Account Type (the same value as Account Type and Contact Type in Lead Alchemist)">
              <span className="field-label !mb-1">Account Type</span>
              <select name="type" defaultValue={type ?? ""} className="input">
                <option value="">Any</option>
                {types.map((t) => (
                  <option key={t} value={t}>{t}</option>
                ))}
                <option value={NO_ACCOUNT_TYPE}>No type</option>
              </select>
            </label>
            <label className="text-sm" title="Primary: the account's one primary contact. Secondary: everyone else on the account.">
              <span className="field-label !mb-1">Client tier (Primary / Secondary)</span>
              <select name="tier" defaultValue={tier ?? ""} className="input">
                <option value="">Any</option>
                <option value="primary">Primary</option>
                <option value="secondary">Secondary</option>
              </select>
            </label>
          </fieldset>
          <fieldset className="flex flex-wrap items-end gap-3">
            <legend className="mb-1 text-xs font-semibold uppercase tracking-wide text-[var(--muted)]">Matching</legend>
            <label className="text-sm" title="Whether they (or their account) are matched to a Lead Alchemist Company. This is about the Company, not about whether the person is in Lead Alchemist.">
              <span className="field-label !mb-1">Lead Alchemist company match</span>
              <select name="company" defaultValue={company ?? ""} className="input">
                <option value="">Any</option>
                {COMPANY_STATES.map((c) => (
                  <option key={c.value} value={c.value}>{c.label}</option>
                ))}
              </select>
            </label>
            <label className="text-sm" title="Other checks: details that differ in Lead Alchemist, possible duplicates, and shortcuts for who is (or isn't) in each system">
              <span className="field-label !mb-1">Other checks</span>
              <select name="filter" defaultValue={filter} className="input">
                {FILTERS.map((f) => (
                  <option key={f.value} value={f.value}>{f.label}</option>
                ))}
              </select>
            </label>
            <button className="btn-secondary">Filter</button>
          </fieldset>
        </form>
      </div>

      <p className="mb-4 text-sm" role="status">
        <span className="font-medium">Showing:</span> {activeText || "everyone"} · {fmt(list.total)} {list.total === 1 ? "person" : "people"}
        {activeText && (
          <>
            {" "}
            · <Link className="btn-link" href="/admin/contacts">Clear filters</Link>
          </>
        )}
      </p>

      {breakdown.total > 0 && (
        <section className="card mb-4 !p-4" aria-labelledby="where-heading">
          <h2 id="where-heading" className="mb-2 text-sm font-semibold">
            Where people are{q ? ` (matching "${q}")` : ""}: <span className="font-normal text-[var(--muted)]">{fmt(breakdown.total)} people</span>
          </h2>
          <div className="overflow-x-auto">
            <table className="data-table text-sm">
              <thead>
                <tr>
                  {SYSTEMS.map((x) => (
                    <th key={x.key} className="text-center">{x.label}</th>
                  ))}
                  <th>Combination</th>
                  <th className="text-right">People</th>
                </tr>
              </thead>
              <tbody>
                {[...breakdown.combos]
                  .sort((a, b) => b.count - a.count)
                  .map((c) => (
                    <tr key={`${c.app}${c.sf}${c.la}`} className={isCombo(c) ? "bg-[var(--accent-soft)]" : undefined}>
                      {SYSTEMS.map((x) => (
                        <td key={x.key} className="text-center" aria-label={c[x.key] ? "yes" : "no"}>
                          {c[x.key] ? <span className="font-semibold text-[var(--success)]">✓</span> : <span className="text-[var(--muted)]">—</span>}
                        </td>
                      ))}
                      <td>
                        <Link className="btn-link" href={comboHref(c)}>{comboLabel(c)}</Link>
                      </td>
                      <td className="text-right font-medium">{fmt(c.count)}</td>
                    </tr>
                  ))}
                {breakdown.laOutdated > 0 && (
                  <tr>
                    <td colSpan={3} />
                    <td>
                      <Link className="btn-link" href="/admin/contacts?filter=la_outdated">Lead Alchemist details missing or different</Link>
                    </td>
                    <td className="text-right font-medium">{fmt(breakdown.laOutdated)}</td>
                  </tr>
                )}
              </tbody>
            </table>
          </div>
        </section>
      )}

      {showSelectionRun(selectionRun) && <SelectionRunPanel run={selectionRun} back={back} stepAction={stepContactsRunAction} stopAction={stopContactsRunAction} />}

      <form id="bulk" className="mb-3 flex flex-wrap items-center gap-2 text-sm">
        <input type="hidden" name="back" value={back} />
        <SubmitButton formAction={addToAppAction} className="btn-secondary">Add selected to AIS Connect</SubmitButton>
        <SubmitButton formAction={sendToLeadAlchemistAction} className="btn-primary" disabled={!laOn} title={laOn ? undefined : "Connect Lead Alchemist first"}>
          Sync selected to Lead Alchemist (and their Company)
        </SubmitButton>
        <SubmitButton formAction={sendToSalesforceAction} className="btn-secondary" disabled={!sfOn} title={sfOn ? undefined : "Connect Salesforce first"}>
          Link or create selected in Salesforce
        </SubmitButton>
        <SubmitButton formAction={updateLaDetailsAction} className="btn-secondary" disabled={!laOn}>
          Update details in Lead Alchemist
        </SubmitButton>
        <label className="flex items-center gap-2" title="Lead Alchemist may start its workflows for new contacts">
          <input type="checkbox" name="createMissing" value="yes" defaultChecked /> Create missing contacts in Lead Alchemist <span className="text-xs text-[var(--muted)]">(creating Lead Alchemist contacts can start its workflows)</span>
        </label>
        <label className="flex items-center gap-2" title="Without this, only fields that are empty in Lead Alchemist are filled">
          <input type="checkbox" name="replace" value="yes" /> Replace Lead Alchemist values that differ
        </label>
      </form>
      <p className="mb-3 max-w-3xl text-xs text-[var(--muted)]">
        Syncing someone who isn&apos;t in AIS Connect adds them first: a Salesforce Contact comes in with its Account, a Lead Alchemist contact joins the
        account linked to its Company (or a new account named after it). In Lead Alchemist they&apos;re put in their account&apos;s Company, their
        empty name, email, phone and address fields are filled in, and links to the account here and in Salesforce are added; in Salesforce,
        they go under their account&apos;s Salesforce Account.
      </p>

      {!runActive && <SelectAllMatching form="bulk" onPage={list.rows.length} total={list.total} noun="people" />}
      <ListSummary total={list.total} state={paging} noun="person" />
      <div className="overflow-x-auto">
        <table className="data-table">
          <thead>
            <tr>
              <th className="w-8"><SelectAll form="bulk" /></th>
              <th>Person</th>
              <th>AIS Connect</th>
              <th>Salesforce</th>
              <th>Lead Alchemist</th>
            </tr>
          </thead>
          <tbody>
            {!list.rows.length && (
              <tr>
                <td colSpan={5} className="text-[var(--muted)]">
                  {counts.salesforce + counts.leadAlchemist === 0 ? "Refresh Salesforce and Lead Alchemist above to see their contacts here." : "No one matches."}
                </td>
              </tr>
            )}
            {list.rows.map((r) => (
              <tr key={r.key}>
                <td><input type="checkbox" name="ids" value={r.key} form="bulk" aria-label={`Select ${r.name}`} /></td>
                <td>
                  <span className="font-medium">{r.name}</span>
                  {r.tier === "primary" && <span className="badge badge-success ml-1">Primary</span>}
                  {r.tier === "secondary" && <span className="badge badge-neutral ml-1">Secondary</span>}
                  {r.accountType && <span className="badge badge-neutral ml-1" title="Their account's Salesforce Account Type">{r.accountType}</span>}
                  <div className="text-xs text-[var(--muted)]">{[r.email, r.phone].filter(Boolean).join(" · ")}</div>
                </td>
                <td className="text-sm">
                  {r.inApp ? (
                    r.accountId ? <Link className="btn-link" href={`/admin/clients/${r.accountId}`}>{r.accountName ?? "Account"}</Link> : "In AIS Connect"
                  ) : (
                    <>
                      <Missing />
                      {r.account ? (
                        <div className="mt-1 text-xs">
                          <span className="badge badge-success" title="Adding this person puts them under this account (no new account)">Account already here</span>{" "}
                          <Link className="btn-link" href={`/admin/clients/${r.account.id}`}>{r.account.name}</Link>
                        </div>
                      ) : (
                        <div className="mt-1 text-xs text-[var(--muted)]">
                          {r.inSf && r.sfAccountId ? "Adding brings in their Salesforce Account as a new account" : "Adding creates a new account"}
                        </div>
                      )}
                    </>
                  )}
                  {r.sameName.app && (
                    <div className="mt-1 text-xs">
                      <span className="badge badge-warning" title="Someone with the same full name is already in AIS Connect, under a different email or phone">Same name here</span>{" "}
                      <Link className="btn-link" href={`/admin/clients/${r.sameName.app.accountId}`}>{r.sameName.app.account}</Link>
                    </div>
                  )}
                </td>
                <td className="text-sm">
                  {r.inSf ? (
                    <>
                      <SystemLink className="btn-link" href={r.sfId ? l.salesforce("Contact", r.sfId) : null} missing="">Contact</SystemLink>
                      {r.sfCompany && (
                        <div className="text-xs">
                          <SystemLink className="btn-link" href={r.sfAccountId ? l.salesforce("Account", r.sfAccountId) : null} missing="">{r.sfCompany}</SystemLink>
                        </div>
                      )}
                    </>
                  ) : (
                    <>
                      <Missing />
                      {r.account?.sfAccountId && (
                        <div className="mt-1 text-xs">
                          Their account is{" "}
                          <SystemLink className="btn-link" href={l.salesforce("Account", r.account.sfAccountId)} missing="">
                            in Salesforce
                          </SystemLink>
                        </div>
                      )}
                    </>
                  )}
                  {r.sameName.sf && (
                    <div className="mt-1 text-xs">
                      <span className="badge badge-warning" title="A Salesforce Contact with the same full name, under a different email or phone">Same name in Salesforce</span>{" "}
                      <SystemLink className="btn-link" href={l.salesforce("Contact", r.sameName.sf.id)} missing="">{r.sameName.sf.company ?? "Contact"}</SystemLink>
                    </div>
                  )}
                </td>
                <td className="text-sm">
                  {r.inLa ? (
                    <>
                      <SystemLink className="btn-link" href={r.laId ? l.ghlContact(r.laId) : null} missing="">Contact</SystemLink>
                      {r.laOutdated && (
                        <div className="text-xs">
                          <span className="badge badge-warning" title="Lead Alchemist is missing (or has a different) name, email or phone">Details to update</span>
                        </div>
                      )}
                    </>
                  ) : (
                    <Missing />
                  )}
                  <CompanyInfo r={r} companyHref={l.ghlCompany} />
                  {r.sameName.la && (
                    <div className="mt-1 text-xs">
                      <span className="badge badge-warning" title="A Lead Alchemist contact with the same full name, under a different email or phone: syncing would add a second one">
                        Same name in Lead Alchemist
                      </span>{" "}
                      <SystemLink className="btn-link" href={l.ghlContact(r.sameName.la.id)} missing="">{r.sameName.la.company ?? "Contact"}</SystemLink>
                    </div>
                  )}
                </td>
              </tr>
            ))}
          </tbody>
        </table>
      </div>
      <Pagination total={list.total} state={paging} noun="person" href={href} />
    </div>
  );
}

/** One system's import: how many contacts are in the directory, when they were read, and Refresh. */
function ImportCard({
  source,
  label,
  connected,
  count,
  run,
  active,
  back,
}: {
  source: DirectorySource;
  label: string;
  connected: boolean;
  count: number;
  run: DirectoryImport | null;
  active: boolean;
  back: string;
}) {
  const running = run?.phase === "running";
  return (
    <form action={importAction} className="card space-y-2 !p-4 text-sm">
      <input type="hidden" name="back" value={back} />
      <input type="hidden" name="source" value={source} />
      <p className="font-semibold">{label} contacts</p>
      {!connected ? (
        <p className="text-[var(--muted)]">Not connected. Add the keys in Settings → Integrations.</p>
      ) : (
        <>
          <p className="text-[var(--muted)]">
            <strong className="text-[var(--text)]">{fmt(count)}</strong> in the list
            {run?.finishedAt && run.phase === "done" && <> · read {new Date(run.finishedAt).toLocaleString("en-US", { timeZone: process.env.APP_TIMEZONE ?? "America/Chicago" })}</>}
            {run?.phase === "failed" && <> · last read stopped: {run.error}</>}
          </p>
          {running ? (
            <div className="flex flex-wrap items-center gap-2">
              <span>
                Reading… {fmt(run.imported)}
                {run.total ? ` of ${fmt(run.total)}` : ""}. Keep this page open.
              </span>
              {active ? <AutoSubmit label="Continue" /> : <SubmitButton>Continue</SubmitButton>}
            </div>
          ) : (
            <>
              <input type="hidden" name="start" value="yes" />
              <SubmitButton className="btn-secondary">{count ? `Refresh from ${label}` : `Read all ${label} contacts`}</SubmitButton>
            </>
          )}
        </>
      )}
    </form>
  );
}
