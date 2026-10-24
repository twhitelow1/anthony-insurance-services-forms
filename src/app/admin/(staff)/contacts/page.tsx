import Link from "next/link";
import { cookies } from "next/headers";
import { AutoSubmit } from "@/components/AutoSubmit";
import { SystemLink } from "@/components/clients";
import { ListSummary, pageHref, pageState, Pagination } from "@/components/Pagination";
import { SelectAll } from "@/components/SelectAll";
import { SubmitButton } from "@/components/SubmitButton";
import { requireStaff } from "@/lib/auth/session";
import { directoryCounts, getImport, listDirectory, type DirectoryFilter, type DirectoryImport, type DirectorySource } from "@/lib/contacts/directory";
import { readFlash } from "@/lib/flash";
import { ghlConfig } from "@/lib/ghl/client";
import { links } from "@/lib/integrations/links";
import { salesforceConfig } from "@/lib/salesforce/config";
import { FlashMessage } from "../salesforce/ui";
import { addToAppAction, importAction, searchContactsAction, sendToLeadAlchemistAction, sendToSalesforceAction, updateLaDetailsAction } from "./actions";
import { CONTACT_SEARCH_COOKIE } from "./search-cookie";

export const metadata = { title: "Contacts | AIS Connect" };
export const dynamic = "force-dynamic";

const FILTERS: { value: DirectoryFilter; label: string }[] = [
  { value: "all", label: "Everyone" },
  { value: "app_only", label: "Only in AIS Connect" },
  { value: "sf_only", label: "Only in Salesforce" },
  { value: "la_only", label: "Only in Lead Alchemist" },
  { value: "not_app", label: "Not in AIS Connect" },
  { value: "not_sf", label: "Not in Salesforce" },
  { value: "not_la", label: "Not in Lead Alchemist" },
  { value: "everywhere", label: "In all three" },
  { value: "la_outdated", label: "Lead Alchemist details missing or different" },
];

const fmt = (n: number) => n.toLocaleString("en-US");
const Missing = () => <span className="badge badge-neutral">Not there</span>;

export default async function Contacts({ searchParams }: PageProps<"/admin/contacts">) {
  await requireStaff("/admin/contacts");
  const sp = await searchParams;
  const str = (k: string) => (typeof sp[k] === "string" ? (sp[k] as string) : "");
  const filter = FILTERS.some((f) => f.value === str("filter")) ? (str("filter") as DirectoryFilter) : "all";
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
    listDirectory({ q, filter, limit: paging.pageSize, offset: paging.offset }),
  ]);
  const href = pageHref("/admin/contacts", { filter: filter !== "all" ? filter : undefined });
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

      <div className="card mb-4 flex flex-wrap items-end gap-3 !p-4">
        <form action={searchContactsAction} className="flex flex-1 flex-wrap gap-3" role="search">
          <input type="hidden" name="back" value={back} />
          <label className="sr-only" htmlFor="q">Search contacts</label>
          <input id="q" name="q" defaultValue={q} className="input min-w-[12rem] flex-1" placeholder="Name, email or phone" />
          <button className="btn-primary">Search</button>
          {q && (
            <button name="clear" value="1" className="btn-secondary">Clear</button>
          )}
        </form>
        <form method="get" className="flex flex-wrap items-end gap-2">
          <label className="text-sm">
            <span className="field-label !mb-1">Show</span>
            <select name="filter" defaultValue={filter} className="input">
              {FILTERS.map((f) => (
                <option key={f.value} value={f.value}>{f.label}</option>
              ))}
            </select>
          </label>
          <button className="btn-secondary">Filter</button>
        </form>
      </div>

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
          <input type="checkbox" name="createMissing" value="yes" /> Create missing contacts in Lead Alchemist
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
                  <div className="text-xs text-[var(--muted)]">{[r.email, r.phone].filter(Boolean).join(" · ")}</div>
                </td>
                <td className="text-sm">
                  {r.inApp ? (
                    r.accountId ? <Link className="btn-link" href={`/admin/clients/${r.accountId}`}>{r.accountName ?? "Account"}</Link> : "In AIS Connect"
                  ) : (
                    <Missing />
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
                    <Missing />
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
                      {r.laCompany ? (
                        <div className="text-xs">
                          <SystemLink className="btn-link" href={r.laCompanyId ? l.ghlCompany(r.laCompanyId) : null} missing="">{r.laCompany}</SystemLink>
                        </div>
                      ) : (
                        <div className="text-xs text-[var(--muted)]">No Company</div>
                      )}
                    </>
                  ) : (
                    <Missing />
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
