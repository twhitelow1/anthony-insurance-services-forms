import Link from "next/link";
import { notFound, redirect } from "next/navigation";
import { forms } from "@/forms";
import { fmtDate, StatusBadge } from "@/components/portal";
import { SalesforceBadge, SystemLink } from "@/components/clients";
import { requireStaff } from "@/lib/auth/session";
import { defaultBrand } from "@/lib/brands";
import {
  clientGhlContactId,
  contactEmailsOf,
  getClient,
  listAccountContacts,
  listClientApplications,
  listClientDrafts,
  listClientEvents,
} from "@/lib/clients/repo";
import { links } from "@/lib/integrations/links";
import { ghlConfig } from "@/lib/ghl/client";
import { salesforceConfig } from "@/lib/salesforce/config";
import { getSettings } from "@/lib/settings";
import { linkGhlContactAction, userModeAction } from "@/app/admin/actions";
import {
  addClientNoteAction,
  keepSeparateAction,
  mergeClientAction,
  mergeIntoDuplicateAction,
  setPrimaryContactAction,
  splitContactAction,
  syncClientAction,
} from "../actions";

const GHL_MESSAGES: Record<string, string> = {
  linked: "Linked to the Lead Alchemist contact.",
  unlinked: "Unlinked. The next sync matches the Lead Alchemist contact by email.",
  no_contact_id: "No Lead Alchemist contact has that ID.",
  no_contact_email: "No Lead Alchemist contact has this email yet. It's created on the next sync.",
  lookup_failed: "The Lead Alchemist lookup failed. Try again in a minute.",
  bad_id: "That isn't a Lead Alchemist contact ID or link.",
  not_connected: "Lead Alchemist isn't connected (LA_API_TOKEN / LA_LOCATION_ID).",
};
const SAVED: Record<string, string> = {
  merged: "Merged. Their contacts, applications and unfinished applications are on this account now.",
  split: "Split off into an account of its own.",
  primary: "Primary contact changed.",
  separate: "Kept as a separate account.",
};
const SF_RESULT: Record<string, string> = {
  done: "Salesforce sync finished. See the activity below.",
  error: "The Salesforce sync failed. The error is below; it's retried automatically, or try again.",
  off: "Salesforce sync is turned off (Admin → Settings) or Salesforce isn't connected yet.",
  none: "No submitted applications to sync yet. Unfinished and test applications aren't sent to Salesforce.",
};

export default async function AccountPage({ params, searchParams }: PageProps<"/admin/clients/[id]">) {
  const { id } = await params;
  await requireStaff(`/admin/clients/${id}`);
  const client = await getClient(id);
  if (!client) notFound();
  // An old link to a merged-away record lands on the merged account.
  if (client.id !== id) redirect(`/admin/clients/${client.id}`);
  const sp = await searchParams;
  const one = (k: string) => (typeof sp[k] === "string" ? (sp[k] as string) : null);

  const [people, apps, drafts, events, ghlContactId, l, settings, duplicateOf] = await Promise.all([
    listAccountContacts(client.id),
    listClientApplications(client.id),
    listClientDrafts(client.id),
    listClientEvents(client.id),
    clientGhlContactId(client.id),
    links(),
    getSettings(),
    client.possibleDuplicateOf ? getClient(client.possibleDuplicateOf) : Promise.resolve(undefined),
  ]);
  const contactEmails = new Map(await Promise.all(people.map(async (p) => [p.id, await contactEmailsOf(p.id)] as const)));
  const appsBy = (contactId: string) => apps.filter((a) => a.contactId === contactId).length;
  const sfReady = !!salesforceConfig() && settings.salesforceEnabled;
  const lastSfEvent = events.find((e) => e.type.startsWith("sf_"));
  const address = [client.address?.street, client.address?.city, [client.address?.state, client.address?.postalCode].filter(Boolean).join(" ")]
    .filter(Boolean)
    .join(", ");
  const message = (one("la") && GHL_MESSAGES[one("la")!]) || (one("saved") && SAVED[one("saved")!]) || (one("sf") && SF_RESULT[one("sf")!]) || null;

  return (
    <div>
      <Link href="/admin/clients" className="btn-link">← All accounts</Link>
      <div className="mb-4 mt-3 flex flex-wrap items-start justify-between gap-4">
        <div>
          <h1 className="text-2xl font-semibold">
            {client.name}{" "}
            <span className="badge badge-neutral align-middle text-xs">{client.isIndividual ? "Individual" : "Business"}</span>
          </h1>
          {client.contactName && client.contactName !== client.name && <p className="text-sm">Primary contact: {client.contactName}</p>}
          <p className="text-sm text-[var(--muted)]">
            {client.phones.map((p, i) => (
              <span key={p}>
                {i ? " · " : ""}
                <a className="btn-link" href={`tel:${p}`}>{p}</a>
              </span>
            ))}
            {client.website && (
              <>
                {client.phones.length ? " · " : ""}
                <a className="btn-link" href={/^https?:/.test(client.website) ? client.website : `https://${client.website}`} target="_blank" rel="noopener">
                  {client.website}
                </a>
              </>
            )}
          </p>
          {address && <p className="text-sm text-[var(--muted)]">{address}</p>}
          <p className="mt-2 flex flex-wrap items-center gap-2 text-sm">
            <span>Salesforce:</span> <SalesforceBadge status={client.sfStatus} title={client.sfLastError} />
            <span className="ml-2">Lead Alchemist Company:</span>
            <span className={`badge ${client.ghlCompanyId ? "badge-success" : "badge-neutral"}`}>{client.ghlCompanyId ? "Linked" : "Not linked"}</span>
            {client.sfSyncedAt && <span className="text-xs text-[var(--muted)]">Last synced {fmtDate(client.sfSyncedAt)}</span>}
          </p>
        </div>
        {client.primaryEmail && (
          <form action={userModeAction}>
            <input type="hidden" name="email" value={client.primaryEmail} />
            <button className="btn-secondary">View portal as the primary contact</button>
          </form>
        )}
      </div>

      <div className="mb-6 flex flex-wrap gap-2">
        <SystemLink href={l.salesforce("Account", client.sfAccountId)} missing="Not linked to a Salesforce Account yet. Use Sync to Salesforce.">
          View Account in Salesforce
        </SystemLink>
        <SystemLink
          href={l.ghlCompany(client.ghlCompanyId)}
          missing="No Lead Alchemist Company yet: link one in Admin → Settings → Data mapping."
        >
          View Company in Lead Alchemist
        </SystemLink>
        <SystemLink href={l.ghlContact(ghlContactId)} missing="Not linked to a Lead Alchemist contact yet.">
          View primary contact in Lead Alchemist
        </SystemLink>
        <form action={syncClientAction}>
          <input type="hidden" name="id" value={client.id} />
          <button
            className="btn-primary"
            disabled={!sfReady}
            title={sfReady ? "Sync every submitted application to Salesforce now" : "Salesforce sync is off or not connected (Admin → Settings)"}
          >
            Sync to Salesforce
          </button>
        </form>
      </div>

      {message && <p className="callout mb-4 text-sm" role="status">{message}</p>}
      {duplicateOf && (
        <div className="mb-4 rounded-lg border border-[var(--notice-border)] bg-[var(--notice-bg)] p-3 text-sm" role="alert">
          <p>
            <strong>Possible duplicate.</strong> This account has the same name as{" "}
            <Link className="btn-link" href={`/admin/clients/${duplicateOf.id}`}>{duplicateOf.name}</Link>, but a different phone, email domain and
            website, so it was kept apart. Same business? Merge it in. Different business? Keep it separate.
          </p>
          <div className="mt-2 flex flex-wrap gap-2">
            <form action={mergeIntoDuplicateAction}>
              <input type="hidden" name="id" value={client.id} />
              <button className="btn-primary">Merge into {duplicateOf.name}</button>
            </form>
            <form action={keepSeparateAction}>
              <input type="hidden" name="id" value={client.id} />
              <button className="btn-secondary">Keep separate</button>
            </form>
          </div>
        </div>
      )}
      {one("error") && <p className="mb-4 rounded-lg bg-[var(--danger-bg)] p-3 text-sm text-[var(--danger)]" role="alert">{one("error")}</p>}
      {client.sfStatus === "needs_review" && (
        <p className="mb-4 rounded-lg border border-[var(--notice-border)] bg-[var(--notice-bg)] p-3 text-sm" role="alert">
          <strong>Salesforce needs a decision.</strong> {client.sfLastError} Nothing was created. Fix or merge the records in Salesforce (or add this
          account&apos;s email to the right Contact there), or pick the Account on the mapping screen, then Sync to Salesforce again.
        </p>
      )}
      {client.sfStatus === "error" && lastSfEvent && (
        <p className="mb-4 rounded-lg bg-[var(--danger-bg)] p-3 text-sm text-[var(--danger)]" role="alert">Last Salesforce error: {client.sfLastError}</p>
      )}

      <section className="card mb-6 overflow-x-auto !p-0" aria-labelledby="contacts-heading">
        <h2 id="contacts-heading" className="px-5 pt-4 font-semibold">Contacts</h2>
        <table className="data-table">
          <thead>
            <tr>
              <th>Name</th>
              <th>Email and phone</th>
              <th>Applications filled out</th>
              <th>Salesforce</th>
              <th>Lead Alchemist</th>
              <th />
            </tr>
          </thead>
          <tbody>
            {people.map((p) => {
              const mails = contactEmails.get(p.id) ?? [];
              const primary = !!p.primaryEmail && p.primaryEmail === client.primaryEmail;
              return (
                <tr key={p.id}>
                  <td>
                    <span className="font-medium">{p.name}</span>
                    {p.title && <div className="text-xs text-[var(--muted)]">{p.title}</div>}
                    {primary && <span className="badge badge-neutral ml-1">Primary</span>}
                    {!p.homeHere && <div className="text-xs text-[var(--muted)]">Belongs to another account; filled out an application here</div>}
                  </td>
                  <td className="text-sm">
                    {mails.map((e) => (
                      <div key={e}><a className="btn-link" href={`mailto:${e}`}>{e}</a></div>
                    ))}
                    {p.phones.map((ph) => (
                      <div key={ph}><a className="btn-link" href={`tel:${ph}`}>{ph}</a></div>
                    ))}
                  </td>
                  <td className="text-sm">{appsBy(p.id) || "—"}</td>
                  <td className="text-sm">
                    <SystemLink className="btn-link text-xs" href={l.salesforce("Contact", p.sfContactId)} missing="Not linked to a Salesforce Contact yet">
                      View Contact
                    </SystemLink>
                  </td>
                  <td className="text-sm">
                    {p.ghlContactId ? (
                      <SystemLink className="btn-link text-xs" href={l.ghlContact(p.ghlContactId)} missing="">
                        View Contact
                      </SystemLink>
                    ) : ghlConfig() && mails[0] ? (
                      <form action={linkGhlContactAction}>
                        <input type="hidden" name="email" value={mails[0]} />
                        <button className="btn-link text-xs">Find in Lead Alchemist</button>
                      </form>
                    ) : (
                      <span className="text-xs text-[var(--muted)]">Not linked</span>
                    )}
                  </td>
                  <td className="text-sm">
                    {!primary && p.primaryEmail && (
                      <form action={setPrimaryContactAction}>
                        <input type="hidden" name="id" value={client.id} />
                        <input type="hidden" name="contactId" value={p.id} />
                        <button className="btn-link text-xs">Make primary</button>
                      </form>
                    )}
                    {people.length > 1 && (
                      <form action={splitContactAction}>
                        <input type="hidden" name="id" value={client.id} />
                        <input type="hidden" name="contactId" value={p.id} />
                        <button className="btn-link text-xs" title="This person belongs to a different business: move them and the applications they filled out to an account of their own">
                          Split off
                        </button>
                      </form>
                    )}
                  </td>
                </tr>
              );
            })}
            {!people.length && (
              <tr><td colSpan={6} className="py-6 text-center text-[var(--muted)]">No contacts yet.</td></tr>
            )}
          </tbody>
        </table>
      </section>

      <section className="card mb-6 overflow-x-auto !p-0" aria-labelledby="apps-heading">
        <h2 id="apps-heading" className="px-5 pt-4 font-semibold">Applications</h2>
        <table className="data-table">
          <thead>
            <tr>
              <th>Reference</th>
              <th>Form</th>
              <th>Filled out by</th>
              <th>Brand</th>
              <th>Status</th>
              <th>Submitted</th>
              <th>PDF</th>
              <th>Salesforce</th>
              <th>Lead Alchemist</th>
            </tr>
          </thead>
          <tbody>
            {apps.map((a) => {
              const form = forms[a.formSlug];
              return (
                <tr key={a.id}>
                  <td>
                    <Link className="row-link font-mono" href={`/admin/applications/${a.id}`}>{a.reference}</Link>
                    {a.isTest && <span className="badge badge-danger ml-1" title="Submitted in staff testing mode">TEST</span>}
                  </td>
                  <td className="text-sm">{form?.title ?? a.formSlug}</td>
                  <td className="text-sm">
                    {a.contactName ?? a.applicantName}
                    <div className="text-xs text-[var(--muted)]">{a.applicantEmail}</div>
                  </td>
                  <td className="text-sm">{form ? defaultBrand(form).toUpperCase() : "—"}</td>
                  <td><StatusBadge status={a.status} /></td>
                  <td className="whitespace-nowrap text-sm">{fmtDate(a.createdAt)}</td>
                  <td><a className="btn-link text-sm" href={`/applications/${a.id}/pdf`} target="_blank" rel="noopener">Open PDF</a></td>
                  <td className="text-sm">
                    <SalesforceBadge status={a.sfSyncStatus} title={a.sfLastError} />
                    <div>
                      <SystemLink className="btn-link text-xs" href={l.salesforce("Opportunity", a.sfOpportunityId)} missing="No Salesforce Opportunity yet">
                        View Opportunity
                      </SystemLink>
                    </div>
                  </td>
                  <td className="text-sm">
                    <SystemLink className="btn-link text-xs" href={l.ghlOpportunity(a.ghlOpportunityId)} missing="No Lead Alchemist opportunity yet">
                      View Opportunity
                    </SystemLink>
                  </td>
                </tr>
              );
            })}
            {drafts.map((d) => (
              <tr key={d.id}>
                <td><span className="badge badge-warning">Started</span></td>
                <td className="text-sm">{forms[d.formSlug]?.title ?? d.formSlug}</td>
                <td className="text-xs text-[var(--muted)]">{d.email}</td>
                <td className="text-sm">{forms[d.formSlug] ? defaultBrand(forms[d.formSlug]).toUpperCase() : "—"}</td>
                <td className="text-sm text-[var(--muted)]">Unfinished (step {d.step + 1})</td>
                <td className="whitespace-nowrap text-sm">{fmtDate(d.updatedAt)}</td>
                <td colSpan={3} className="text-xs text-[var(--muted)]">Not submitted, so not in Salesforce</td>
              </tr>
            ))}
            {!apps.length && !drafts.length && (
              <tr><td colSpan={9} className="py-8 text-center text-[var(--muted)]">No applications yet.</td></tr>
            )}
          </tbody>
        </table>
      </section>

      <div className="grid gap-6 lg:grid-cols-2">
        <section className="card space-y-3 !p-5 lg:col-span-2" aria-labelledby="merge-heading">
          <h2 id="merge-heading" className="font-semibold">Merge</h2>
          <form action={mergeClientAction} className="space-y-2">
            <input type="hidden" name="id" value={client.id} />
            <label className="block text-sm" htmlFor="other">
              Same business recorded twice? Paste the other account&apos;s page link to merge it (its contacts and applications) into this one.
            </label>
            <input id="other" name="other" className="input" placeholder="https://…/admin/clients/…" required />
            <button className="btn-secondary">Merge into this account</button>
          </form>
        </section>

        <section className="card space-y-3 !p-5 lg:col-span-2" aria-labelledby="activity-heading">
          <h2 id="activity-heading" className="font-semibold">Notes and activity</h2>
          <form action={addClientNoteAction} className="space-y-2">
            <input type="hidden" name="id" value={client.id} />
            <label className="sr-only" htmlFor="message">Note</label>
            <textarea id="message" name="message" rows={2} className="input" required placeholder="Internal note about this account" />
            <button className="btn-secondary">Add note</button>
          </form>
          <ol className="space-y-2 text-sm">
            {events.map((e) => (
              <li key={e.id} className="border-l-2 border-[var(--border)] pl-3">
                <span className="text-xs text-[var(--muted)]">
                  {fmtDate(e.createdAt)} · {e.actor.replace(/^staff:/, "")}
                </span>
                <div>{e.message}</div>
              </li>
            ))}
            {!events.length && <li className="text-[var(--muted)]">Nothing yet.</li>}
          </ol>
        </section>
      </div>
    </div>
  );
}
