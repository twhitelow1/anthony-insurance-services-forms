import Link from "next/link";
import { notFound, redirect } from "next/navigation";
import { forms } from "@/forms";
import { fmtDate, StatusBadge } from "@/components/portal";
import { SalesforceBadge, SystemLink } from "@/components/clients";
import { requireStaff } from "@/lib/auth/session";
import { defaultBrand } from "@/lib/brands";
import {
  clientEmailsOf,
  clientGhlContactId,
  getClient,
  listClientApplications,
  listClientDrafts,
  listClientEvents,
} from "@/lib/clients/repo";
import { links } from "@/lib/integrations/links";
import { ghlConfig } from "@/lib/ghl/client";
import { salesforceConfig } from "@/lib/salesforce/config";
import { getSettings } from "@/lib/settings";
import { linkGhlContactAction, unlinkGhlContactAction, userModeAction } from "@/app/admin/actions";
import {
  addClientNoteAction,
  mergeClientAction,
  setPrimaryEmailAction,
  splitEmailAction,
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
  merged: "Merged. Their emails, applications and unfinished applications are on this client now.",
  split: "Split off into this client of its own.",
  primary: "Primary email changed.",
};
const SF_RESULT: Record<string, string> = {
  done: "Salesforce sync finished. See the activity below.",
  error: "The Salesforce sync failed. The error is below; it's retried automatically, or try again.",
  off: "Salesforce sync is turned off (Admin → Settings) or Salesforce isn't connected yet.",
  none: "No submitted applications to sync yet. Unfinished and test applications aren't sent to Salesforce.",
};

export default async function ClientPage({ params, searchParams }: PageProps<"/admin/clients/[id]">) {
  const { id } = await params;
  await requireStaff(`/admin/clients/${id}`);
  const client = await getClient(id);
  if (!client) notFound();
  // An old link to a merged-away record lands on the merged client.
  if (client.id !== id) redirect(`/admin/clients/${client.id}`);
  const sp = await searchParams;
  const one = (k: string) => (typeof sp[k] === "string" ? (sp[k] as string) : null);

  const [emails, apps, drafts, events, ghlContactId, l, settings] = await Promise.all([
    clientEmailsOf(client.id),
    listClientApplications(client.id),
    listClientDrafts(client.id),
    listClientEvents(client.id),
    clientGhlContactId(client.id),
    links(),
    getSettings(),
  ]);
  const sfReady = !!salesforceConfig() && settings.salesforceEnabled;
  const lastSfEvent = events.find((e) => e.type.startsWith("sf_"));
  const address = [client.address?.street, client.address?.city, [client.address?.state, client.address?.postalCode].filter(Boolean).join(" ")]
    .filter(Boolean)
    .join(", ");
  const message = (one("la") && GHL_MESSAGES[one("la")!]) || (one("saved") && SAVED[one("saved")!]) || (one("sf") && SF_RESULT[one("sf")!]) || null;

  return (
    <div>
      <Link href="/admin/clients" className="btn-link">← All clients</Link>
      <div className="mb-4 mt-3 flex flex-wrap items-start justify-between gap-4">
        <div>
          <h1 className="text-2xl font-semibold">{client.name}</h1>
          {client.contactName && client.contactName !== client.name && <p className="text-sm">{client.contactName}</p>}
          <p className="text-sm text-[var(--muted)]">
            {emails.map((e, i) => (
              <span key={e}>
                {i ? " · " : ""}
                <a className="btn-link" href={`mailto:${e}`}>{e}</a>
              </span>
            ))}
            {client.phones.map((p) => (
              <span key={p}>
                {" · "}
                <a className="btn-link" href={`tel:${p}`}>{p}</a>
              </span>
            ))}
          </p>
          {address && <p className="text-sm text-[var(--muted)]">{address}</p>}
          <p className="mt-2 flex flex-wrap items-center gap-2 text-sm">
            <span>Salesforce:</span> <SalesforceBadge status={client.sfStatus} title={client.sfLastError} />
            <span className="ml-2">Lead Alchemist:</span>
            <span className={`badge ${ghlContactId ? "badge-success" : "badge-neutral"}`}>{ghlContactId ? "Linked" : "Not linked"}</span>
            {client.sfSyncedAt && <span className="text-xs text-[var(--muted)]">Last synced {fmtDate(client.sfSyncedAt)}</span>}
          </p>
        </div>
        <form action={userModeAction}>
          <input type="hidden" name="email" value={client.primaryEmail} />
          <button className="btn-secondary">View portal as this client</button>
        </form>
      </div>

      <div className="mb-6 flex flex-wrap gap-2">
        <SystemLink href={l.salesforce("Account", client.sfAccountId)} missing="Not linked to a Salesforce Account yet. Use Sync to Salesforce.">
          View Account in Salesforce
        </SystemLink>
        <SystemLink
          href={l.ghlCompany(client.ghlCompanyId)}
          missing="No Lead Alchemist Company yet: Companies aren't connected (see docs/lead-alchemist-companies-plan.md)."
        >
          View Company in Lead Alchemist
        </SystemLink>
        <SystemLink href={l.ghlContact(ghlContactId)} missing="Not linked to a Lead Alchemist contact yet.">
          View Contact in Lead Alchemist
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
      {one("error") && <p className="mb-4 rounded-lg bg-[var(--danger-bg)] p-3 text-sm text-[var(--danger)]" role="alert">{one("error")}</p>}
      {client.sfStatus === "needs_review" && (
        <p className="mb-4 rounded-lg border border-[var(--notice-border)] bg-[var(--notice-bg)] p-3 text-sm" role="alert">
          <strong>Salesforce needs a decision.</strong> {client.sfLastError} Nothing was created. Fix or merge the records in Salesforce (or add this
          client&apos;s email to the right Contact there), then Sync to Salesforce again.
        </p>
      )}
      {client.sfStatus === "error" && lastSfEvent && (
        <p className="mb-4 rounded-lg bg-[var(--danger-bg)] p-3 text-sm text-[var(--danger)]" role="alert">Last Salesforce error: {client.sfLastError}</p>
      )}

      <section className="card mb-6 overflow-x-auto !p-0" aria-labelledby="apps-heading">
        <h2 id="apps-heading" className="px-5 pt-4 font-semibold">Applications</h2>
        <table className="data-table">
          <thead>
            <tr>
              <th>Reference</th>
              <th>Form</th>
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
                  <td className="text-sm">
                    {form?.title ?? a.formSlug}
                    {emails.length > 1 && <div className="text-xs text-[var(--muted)]">{a.applicantEmail}</div>}
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
                <td className="text-sm">{forms[d.formSlug] ? defaultBrand(forms[d.formSlug]).toUpperCase() : "—"}</td>
                <td className="text-sm text-[var(--muted)]">Unfinished (step {d.step + 1})</td>
                <td className="whitespace-nowrap text-sm">{fmtDate(d.updatedAt)}</td>
                <td colSpan={3} className="text-xs text-[var(--muted)]">Not submitted, so not in Salesforce</td>
              </tr>
            ))}
            {!apps.length && !drafts.length && (
              <tr><td colSpan={8} className="py-8 text-center text-[var(--muted)]">No applications yet.</td></tr>
            )}
          </tbody>
        </table>
      </section>

      <div className="grid gap-6 lg:grid-cols-2">
        <section className="card space-y-3 !p-5" aria-labelledby="emails-heading">
          <h2 id="emails-heading" className="font-semibold">Emails</h2>
          <ul className="space-y-2 text-sm">
            {emails.map((e) => (
              <li key={e} className="flex flex-wrap items-center gap-2">
                <span className="font-medium">{e}</span>
                {e === client.primaryEmail ? (
                  <span className="badge badge-neutral">Primary</span>
                ) : (
                  <form action={setPrimaryEmailAction}>
                    <input type="hidden" name="id" value={client.id} />
                    <input type="hidden" name="email" value={e} />
                    <button className="btn-link text-xs">Make primary</button>
                  </form>
                )}
                {emails.length > 1 && (
                  <form action={splitEmailAction}>
                    <input type="hidden" name="id" value={client.id} />
                    <input type="hidden" name="email" value={e} />
                    <button className="btn-link text-xs" title="This email belongs to someone else: move it and its applications to a client of its own">
                      Split off
                    </button>
                  </form>
                )}
              </li>
            ))}
          </ul>
          <form action={mergeClientAction} className="space-y-2 border-t border-[var(--border)] pt-3">
            <input type="hidden" name="id" value={client.id} />
            <label className="block text-sm" htmlFor="other">
              Same client under another email? Paste the other client&apos;s page link to merge it into this one.
            </label>
            <input id="other" name="other" className="input" placeholder="https://…/admin/clients/…" required />
            <button className="btn-secondary">Merge into this client</button>
          </form>
        </section>

        <section className="card space-y-3 !p-5" aria-labelledby="ghl-heading">
          <h2 id="ghl-heading" className="font-semibold">Lead Alchemist contact</h2>
          {ghlContactId ? (
            <p className="text-sm">
              Linked to <code className="text-xs">{ghlContactId}</code>. Every application syncs to this contact, each as its own opportunity.
            </p>
          ) : (
            <p className="text-sm text-[var(--muted)]">Not linked yet. The next sync matches the Lead Alchemist contact by email, or link one now.</p>
          )}
          {ghlConfig() ? (
            <>
              <form action={linkGhlContactAction} className="flex flex-wrap items-end gap-2">
                <input type="hidden" name="email" value={client.primaryEmail} />
                <label className="grow text-sm">
                  <span className="mb-1 block text-[var(--muted)]">Contact ID or link (blank: find by email)</span>
                  <input name="contactId" className="input" />
                </label>
                <button className="btn-secondary">{ghlContactId ? "Re-link" : "Find in Lead Alchemist"}</button>
              </form>
              {ghlContactId && (
                <form action={unlinkGhlContactAction}>
                  <input type="hidden" name="email" value={client.primaryEmail} />
                  <button className="btn-link text-sm">Unlink</button>
                </form>
              )}
            </>
          ) : (
            <p className="text-sm text-[var(--muted)]">Lead Alchemist isn&apos;t connected (LA_API_TOKEN / LA_LOCATION_ID).</p>
          )}
        </section>

        <section className="card space-y-3 !p-5 lg:col-span-2" aria-labelledby="activity-heading">
          <h2 id="activity-heading" className="font-semibold">Notes and activity</h2>
          <form action={addClientNoteAction} className="space-y-2">
            <input type="hidden" name="id" value={client.id} />
            <label className="sr-only" htmlFor="message">Note</label>
            <textarea id="message" name="message" rows={2} className="input" required placeholder="Internal note about this client" />
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
