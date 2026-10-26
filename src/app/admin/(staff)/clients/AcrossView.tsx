import Link from "next/link";
import { AutoSubmit } from "@/components/AutoSubmit";
import { LA_COMPANY_HINT, SystemLink } from "@/components/clients";
import { ListSummary, pageHref, pageState, Pagination } from "@/components/Pagination";
import { SelectAll } from "@/components/SelectAll";
import { SelectAllMatching } from "@/components/SelectAllMatching";
import { SelectionRunPanel } from "@/components/SelectionRunPanel";
import { SubmitButton } from "@/components/SubmitButton";
import {
  accountBreakdown,
  accountDirectoryCounts,
  getAccountImport,
  listAccountDirectory,
  type AccountDirRow,
  type AccountImport,
  type AccountMatchFilter,
  type AccountPresence,
  type AccountSource,
  accountTypesAcross,
  NO_ACCOUNT_TYPE,
} from "@/lib/accounts/directory";
import { getSelectionRun, showSelectionRun } from "@/lib/bulk/selection-run";
import { ghlConfig } from "@/lib/ghl/client";
import { links } from "@/lib/integrations/links";
import { salesforceConfig } from "@/lib/salesforce/config";
import {
  accountsToLeadAlchemistAction,
  accountsToSalesforceAction,
  addAccountsToAppAction,
  importAccountsAction,
  linkSuggestedAction,
  searchAcrossAction,
  stepAccountsRunAction,
  stopAccountsRunAction,
} from "./across-actions";
import { openMergeAction } from "./merge/actions";

const fmt = (n: number) => n.toLocaleString("en-US");
const SYSTEMS = [
  { key: "app", label: "AIS Connect" },
  { key: "sf", label: "Salesforce" },
  { key: "la", label: "Lead Alchemist" },
] as const;
type SystemKey = (typeof SYSTEMS)[number]["key"];
const yesNo = (v: string) => (v === "yes" || v === "no" ? v : undefined);

function comboLabel(c: Record<SystemKey, boolean>) {
  const inSys = SYSTEMS.filter((s) => c[s.key]).map((s) => s.label);
  const outSys = SYSTEMS.filter((s) => !c[s.key]).map((s) => s.label);
  if (!outSys.length) return "In all three";
  if (inSys.length === 1) return `Only in ${inSys[0]}`;
  return `In ${inSys.join(" and ")}, not ${outSys.join(" or ")}`;
}

const Missing = () => <span className="badge badge-neutral">Not there</span>;
const contactsText = (n: number) => `${fmt(n)} contact${n === 1 ? "" : "s"}`;

/**
 * Accounts → "Across all three": every account, Salesforce Account and Lead Alchemist Company as
 * one list, with where each is, how many contacts it has in each system, likely matches, filters,
 * and bulk sync. `q` comes from the Accounts search cookie.
 */
export async function AcrossView({ sp, q, flash }: { sp: Record<string, string | string[] | undefined>; q: string; flash: React.ReactNode }) {
  const str = (k: string) => (typeof sp[k] === "string" ? (sp[k] as string) : "");
  const presence: AccountPresence = { app: yesNo(str("app")), sf: yesNo(str("sf")), la: yesNo(str("la")) };
  const match = (["suggested", "none"] as AccountMatchFilter[]).find((m) => m === str("match"));
  const laMissing = str("lacontacts") === "missing";
  const type = str("type").slice(0, 80) || null;
  const paging = pageState(sp);
  const importing = str("importing");
  const [l, laOn, sfOn, counts, sfImport, laImport, list, breakdown, selectionRun, types] = await Promise.all([
    links(),
    ghlConfig(),
    salesforceConfig(),
    accountDirectoryCounts(),
    getAccountImport("salesforce"),
    getAccountImport("lead_alchemist"),
    listAccountDirectory({ q, presence, match, laMissing, type, limit: paging.pageSize, offset: paging.offset }),
    accountBreakdown(q, type),
    getSelectionRun("accounts"),
    accountTypesAcross(),
  ]);
  const params = { view: "all", app: presence.app, sf: presence.sf, la: presence.la, match, lacontacts: laMissing ? "missing" : undefined, type: type ?? undefined };
  const href = pageHref("/admin/clients", params);
  const back = href(paging.page, paging.pageSize);
  const runActive = selectionRun?.phase === "running";
  const comboHref = (c: Record<SystemKey, boolean>) =>
    `/admin/clients?${new URLSearchParams({ view: "all", app: c.app ? "yes" : "no", sf: c.sf ? "yes" : "no", la: c.la ? "yes" : "no", ...(type ? { type } : {}) })}`;
  const isCombo = (c: Record<SystemKey, boolean>) => !match && !laMissing && SYSTEMS.every((x) => presence[x.key] === (c[x.key] ? "yes" : "no"));

  return (
    <div>
      <p className="mb-4 max-w-3xl text-sm text-[var(--muted)]">
        Every account in AIS Connect, plus the Salesforce Accounts and Lead Alchemist Companies that aren&apos;t linked to one, with how many
        contacts each has in each system. Where something isn&apos;t linked yet, a likely match (same name, else same phone) is shown: link it
        instead of creating a duplicate. Nothing is deleted anywhere.
      </p>
      {flash}
      <div className="mb-4 grid gap-3 md:grid-cols-2">
        <ImportCard source="salesforce" label="Salesforce Accounts" connected={!!sfOn} count={counts.salesforce} run={sfImport} active={importing === "salesforce"} back={back} />
        <ImportCard
          source="lead_alchemist"
          label="Lead Alchemist Companies"
          connected={!!laOn}
          count={counts.leadAlchemist}
          run={laImport}
          active={importing === "lead_alchemist"}
          back={back}
        />
      </div>

      <div className="card mb-4 flex flex-wrap items-end gap-3 !p-4">
        <form action={searchAcrossAction} className="flex w-full flex-wrap gap-3" role="search">
          <input type="hidden" name="back" value={back} />
          <label className="sr-only" htmlFor="across-q">Search accounts</label>
          <input id="across-q" name="q" defaultValue={q} className="input min-w-[16rem] flex-1 !py-3 !text-lg" placeholder="Account name" />
          <button className="btn-primary">Search</button>
          {q && (
            <button name="clear" value="1" className="btn-secondary">Clear</button>
          )}
        </form>
        <form key={JSON.stringify(params)} method="get" className="flex flex-wrap items-end gap-2">
          <input type="hidden" name="view" value="all" />
          {SYSTEMS.map((x) => (
            <label key={x.key} className="text-sm">
              <span className="field-label !mb-1">In {x.label}</span>
              <select name={x.key} defaultValue={presence[x.key] ?? ""} className="input">
                <option value="">Either</option>
                <option value="yes">Yes</option>
                <option value="no">No</option>
              </select>
            </label>
          ))}
          <label className="text-sm">
            <span className="field-label !mb-1">Suggested match</span>
            <select name="match" defaultValue={match ?? ""} className="input">
              <option value="">Any</option>
              <option value="suggested">Has one</option>
              <option value="none">None</option>
            </select>
          </label>
          <label className="text-sm" title="AIS Connect accounts with contacts that aren't in Lead Alchemist yet">
            <span className="field-label !mb-1">Contacts in Lead Alchemist</span>
            <select name="lacontacts" defaultValue={laMissing ? "missing" : ""} className="input">
              <option value="">Any</option>
              <option value="missing">Some not there yet</option>
            </select>
          </label>
          <label className="text-sm" title="The Salesforce Account Type: the account's status, changed only in Salesforce">
            <span className="field-label !mb-1">Account Type</span>
            <select name="type" defaultValue={type ?? ""} className="input">
              <option value="">All types</option>
              {types.map((t) => (
                <option key={t} value={t}>{t}</option>
              ))}
              <option value={NO_ACCOUNT_TYPE}>No type</option>
            </select>
          </label>
          <button className="btn-secondary">Filter</button>
          {(presence.app || presence.sf || presence.la || match || laMissing || type) && (
            <Link className="btn-link text-sm" href="/admin/clients?view=all">Clear filters</Link>
          )}
        </form>
      </div>

      {breakdown.total > 0 && (
        <section className="card mb-4 !p-4" aria-labelledby="acct-where-heading">
          <h2 id="acct-where-heading" className="mb-2 text-sm font-semibold">
            Where accounts are{q ? ` (matching "${q}")` : ""}: <span className="font-normal text-[var(--muted)]">{fmt(breakdown.total)}</span>
          </h2>
          <div className="overflow-x-auto">
            <table className="data-table text-sm">
              <thead>
                <tr>
                  {SYSTEMS.map((x) => (
                    <th key={x.key} className="text-center">{x.label}</th>
                  ))}
                  <th>Combination</th>
                  <th className="text-right">Accounts</th>
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
                {breakdown.laMissing > 0 && (
                  <tr>
                    <td colSpan={3} />
                    <td>
                      <Link className="btn-link" href={`/admin/clients?view=all&app=yes&lacontacts=missing${type ? `&type=${encodeURIComponent(type)}` : ""}`}>
                        AIS Connect accounts with contacts not in Lead Alchemist yet ({fmt(breakdown.laMissingContacts)} contacts)
                      </Link>
                    </td>
                    <td className="text-right font-medium">{fmt(breakdown.laMissing)}</td>
                  </tr>
                )}
                {breakdown.suggested > 0 && (
                  <tr>
                    <td colSpan={3} />
                    <td>
                      <Link className="btn-link" href="/admin/clients?view=all&match=suggested">Has a suggested match to link</Link>
                    </td>
                    <td className="text-right font-medium">{fmt(breakdown.suggested)}</td>
                  </tr>
                )}
              </tbody>
            </table>
          </div>
        </section>
      )}

      {laMissing && (
        <div className="callout mb-4 text-sm">
          <strong>Put all these contacts in Lead Alchemist:</strong> tick the box at the top of the list, choose <em>Select all matching</em>, keep{" "}
          <em>Create missing contacts in Lead Alchemist</em> ticked, then press <em>Sync selected to Lead Alchemist (Company + contacts)</em>. Each
          account gets its Company (the linked one, one with the same name, or a new one) and every contact is linked by email or phone, or created,
          and put in it. It runs in batches and ends with a report.
        </div>
      )}
      {showSelectionRun(selectionRun) && <SelectionRunPanel run={selectionRun} back={back} stepAction={stepAccountsRunAction} stopAction={stopAccountsRunAction} />}

      {/* Keyed so the "Create missing contacts" default follows the filter after in-page navigation. */}
      <form key={laMissing ? "la-missing" : "all"} id="acct-bulk" className="mb-3 flex flex-wrap items-center gap-2 text-sm">
        <input type="hidden" name="back" value={back} />
        <SubmitButton formAction={addAccountsToAppAction} className="btn-secondary" title="Salesforce Accounts come in with their Contacts; Lead Alchemist Companies become accounts">
          Add selected to AIS Connect
        </SubmitButton>
        <SubmitButton formAction={accountsToLeadAlchemistAction} className="btn-primary" disabled={!laOn} title={laOn ? "Company (linked, same name, or new) and its contacts" : "Connect Lead Alchemist first"}>
          Sync selected to Lead Alchemist (Company + contacts)
        </SubmitButton>
        <SubmitButton formAction={accountsToSalesforceAction} className="btn-secondary" disabled={!sfOn} title={sfOn ? "Account (linked, same name, or new) with its contacts under it" : "Connect Salesforce first"}>
          Link or create selected in Salesforce
        </SubmitButton>
        <SubmitButton formAction={linkSuggestedAction} className="btn-secondary" title="Only links to the suggested matches; nothing is created anywhere">
          Link suggested matches only
        </SubmitButton>
        <SubmitButton formAction={openMergeAction} className="btn-secondary" title="Tick 2 to 4 rows that are the same business: compare them side by side and pick what stays">
          Compare &amp; merge selected
        </SubmitButton>
        <label className="flex items-center gap-2" title="Without this, a suggested match is ignored and a new record is made when nothing has the same name">
          <input type="checkbox" name="useSuggested" value="yes" defaultChecked /> Use suggested matches (link instead of creating)
        </label>
        <label className="flex items-center gap-2" title="Lead Alchemist may start its workflows for new contacts">
          <input type="checkbox" name="createMissing" value="yes" defaultChecked /> Create missing contacts in Lead Alchemist <span className="text-xs text-[var(--muted)]">(creating Lead Alchemist contacts can start its workflows)</span>
        </label>
      </form>

      {!runActive && <SelectAllMatching form="acct-bulk" onPage={list.rows.length} total={list.total} noun="accounts" />}
      <ListSummary total={list.total} state={paging} noun="account" />
      <div className="overflow-x-auto">
        <table className="data-table">
          <thead>
            <tr>
              <th className="w-8"><SelectAll form="acct-bulk" /></th>
              <th>Account</th>
              <th>AIS Connect</th>
              <th>Salesforce</th>
              <th>Lead Alchemist</th>
            </tr>
          </thead>
          <tbody>
            {!list.rows.length && (
              <tr>
                <td colSpan={5} className="text-[var(--muted)]">
                  {counts.salesforce || counts.leadAlchemist ? "No accounts match these filters." : "Refresh Salesforce and Lead Alchemist above to compare them here."}
                </td>
              </tr>
            )}
            {list.rows.map((r) => (
              <Row key={r.key} r={r} l={l} />
            ))}
          </tbody>
        </table>
      </div>
      <Pagination total={list.total} state={paging} noun="account" href={href} />
    </div>
  );
}

function Suggestion({ label, how, href, name, title }: { label: string; how?: string; href: string | null; name: string; title?: string }) {
  return (
    <div className="mt-1 text-xs">
      <span className="badge badge-warning" title="Probably the same business, not linked yet: use 'Link suggested matches' or the sync buttons with 'Use suggested matches' ticked">
        {label}
        {how ? ` (${how})` : ""}
      </span>{" "}
      <SystemLink title={title} className="btn-link" href={href} missing="">
        {name}
      </SystemLink>
    </div>
  );
}

/** This row and its suggested matches, for "Compare & merge". */
function mergeKeys(r: AccountDirRow) {
  return [
    r.key,
    r.suggested.app && `a:${r.suggested.app.id}`,
    r.suggested.duplicate && `a:${r.suggested.duplicate.id}`,
    r.suggested.sf && `s:${r.suggested.sf.id}`,
    r.suggested.la && `l:${r.suggested.la.id}`,
  ].filter((k): k is string => !!k);
}

function Row({ r, l }: { r: AccountDirRow; l: Awaited<ReturnType<typeof links>> }) {
  return (
    <tr>
      <td><input type="checkbox" name="ids" value={r.key} form="acct-bulk" aria-label={`Select ${r.name}`} /></td>
      <td>
        <span className="font-medium">{r.name}</span>
        {r.isIndividual && <span className="badge badge-neutral ml-1">Individual</span>}
        {mergeKeys(r).length > 1 && (
          <div className="mt-1 text-xs">
            <Link className="btn-link" href={`/admin/clients/merge?${new URLSearchParams({ keys: mergeKeys(r).join(",") })}`}>Compare &amp; merge</Link>
          </div>
        )}
      </td>
      <td className="text-sm">
        {r.appId ? (
          <>
            <Link className="btn-link" href={`/admin/clients/${r.appId}`}>Account</Link>
            <div className="text-xs text-[var(--muted)]">
              {contactsText(r.counts.appContacts)} · {fmt(r.counts.applications)} application{r.counts.applications === 1 ? "" : "s"}
            </div>
            {r.suggested.duplicate && <Suggestion label="Same name, another account" href={`/admin/clients/${r.suggested.duplicate.id}`} name={r.suggested.duplicate.name} />}
          </>
        ) : (
          <>
            <Missing />
            {r.suggested.app && <Suggestion label="Same name here" href={`/admin/clients/${r.suggested.app.id}`} name={r.suggested.app.name} />}
          </>
        )}
      </td>
      <td className="text-sm">
        {r.sfId ? (
          <>
            <SystemLink className="btn-link" href={l.salesforce("Account", r.sfId)} missing="">{r.sfName ?? "Account"}</SystemLink>
            <div className="text-xs text-[var(--muted)]">
              {r.sfType ? `${r.sfType} · ` : ""}
              {contactsText(r.counts.sfContacts)}
            </div>
          </>
        ) : (
          <>
            <Missing />
            {r.suggested.sf && <Suggestion label="Matching Account" how={r.suggested.sf.how} href={l.salesforce("Account", r.suggested.sf.id)} name={r.suggested.sf.name} />}
          </>
        )}
      </td>
      <td className="text-sm">
        {r.laId ? (
          <>
            <SystemLink title={LA_COMPANY_HINT} className="btn-link" href={l.ghlCompany(r.laId)} missing="">{r.laName ?? "Company"}</SystemLink>
            <div className="text-xs text-[var(--muted)]">{contactsText(r.counts.laContacts)}</div>
            {r.counts.appNotInLa > 0 && <div className="text-xs"><span className="badge badge-warning">{fmt(r.counts.appNotInLa)} not in Lead Alchemist yet</span></div>}
          </>
        ) : (
          <>
            <Missing />
            {r.suggested.la && (
              <Suggestion label="Matching Company" how={r.suggested.la.how} href={l.ghlCompany(r.suggested.la.id)} name={r.suggested.la.name} title={LA_COMPANY_HINT} />
            )}
            {r.appId && r.counts.appNotInLa > 0 && <div className="mt-1 text-xs"><span className="badge badge-warning">{fmt(r.counts.appNotInLa)} contact{r.counts.appNotInLa === 1 ? "" : "s"} not in Lead Alchemist yet</span></div>}
          </>
        )}
      </td>
    </tr>
  );
}

function ImportCard({
  source,
  label,
  connected,
  count,
  run,
  active,
  back,
}: {
  source: AccountSource;
  label: string;
  connected: boolean;
  count: number;
  run: AccountImport | null;
  active: boolean;
  back: string;
}) {
  const running = run?.phase === "running";
  return (
    <form action={importAccountsAction} className="card space-y-2 !p-4 text-sm">
      <input type="hidden" name="back" value={back} />
      <input type="hidden" name="source" value={source} />
      <p className="font-semibold">{label}</p>
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
              <SubmitButton className="btn-secondary">{count ? `Refresh ${label}` : `Read all ${label}`}</SubmitButton>
            </>
          )}
        </>
      )}
    </form>
  );
}
