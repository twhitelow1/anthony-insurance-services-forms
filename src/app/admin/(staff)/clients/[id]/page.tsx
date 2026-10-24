import { ListSummary, pageHref, pageState, Pagination } from "@/components/Pagination";
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
  countClientEvents,
  lastSalesforceEvent,
  listClientEvents,
} from "@/lib/clients/repo";
import { links } from "@/lib/integrations/links";
import { ghlConfig } from "@/lib/ghl/client";
import { salesforceConfig } from "@/lib/salesforce/config";
import { getSettings } from "@/lib/settings";
import { userModeAction } from "@/app/admin/actions";
import { externalDifferences, SOURCE_LABEL } from "@/lib/contacts/external";
import { ACTIVE, listNotifications } from "@/lib/notifications/repo";
import { readFlash } from "@/lib/flash";
import { deactivateAccountAction, reactivateAccountAction, relinkAccountAction } from "../../salesforce/actions";
import { AccountLifecycle, FlashMessage } from "../../salesforce/ui";
import {
  addClientNoteAction,
  keepSeparateAction,
  mergeClientAction,
  mergeIntoDuplicateAction,
  setPrimaryContactAction,
  splitContactAction,
  syncClientAction,
  refreshFromSalesforceAction,
  refreshContactsAction,
  pushContactValueAction,
  updateLaContactAction,
  addToLeadAlchemistAction,
} from "../actions";

const GHL_MESSAGES: Record<string, string> = {
  linked: "Linked to the Lead Alchemist contact.",
  unlinked: "Unlinked. The next sync matches the Lead Alchemist contact by email.",
  no_contact_id: "No Lead Alchemist contact has that ID.",
  no_contact_email: "No Lead Alchemist contact has this email yet. It's created on the next sync.",
  lookup_failed: "The Lead Alchemist lookup failed. Try again in a minute.",
  bad_id: "That isn't a Lead Alchemist contact ID or link.",
  not_connected: "Lead Alchemist isn't connected (Settings → Integrations).",
};
const SAVED: Record<string, string> = {
  merged: "Merged. Their contacts, applications and unfinished applications are on this account now.",
  split: "Split off into an account of its own.",
  primary: "Primary contact changed.",
  separate: "Kept as a separate account.",
  refreshed: "Read from Salesforce. Its values are shown beside AIS Connect's; nothing in AIS Connect was overwritten.",
  checked: "Checked Salesforce and Lead Alchemist for each contact's email and phone.",
  pushed: "Sent to the other system. It's on the account's activity log.",
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
  const flash = await readFlash(sp.f);

  const activityPaging = pageState(sp, 25, "activity");
  const [people, apps, drafts, events, eventTotal, lastSfEvent, ghlContactId, l, settings, duplicateOf] = await Promise.all([
    listAccountContacts(client.id),
    listClientApplications(client.id),
    listClientDrafts(client.id),
    listClientEvents(client.id, { limit: activityPaging.pageSize, offset: activityPaging.offset }),
    countClientEvents(client.id),
    lastSalesforceEvent(client.id),
    clientGhlContactId(client.id),
    links(),
    getSettings(),
    client.possibleDuplicateOf ? getClient(client.possibleDuplicateOf) : Promise.resolve(undefined),
  ]);
  const contactEmails = new Map(await Promise.all(people.map(async (p) => [p.id, await contactEmailsOf(p.id)] as const)));
  const appsBy = (contactId: string) => apps.filter((a) => a.contactId === contactId).length;
  const sfReady = !!(await salesforceConfig()) && settings.salesforceEnabled;
  const laConnected = !!(await ghlConfig());
  const sfConnected = !!(await salesforceConfig());
  const alerts = await listNotifications({ clientId: client.id, status: ACTIVE, limit: 20 });
  const diffs = new Map(await Promise.all(people.map(async (p) => [p.id, await externalDifferences(p)] as const)));
  const snap = client.sfSnapshot;
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
        {client.ghlCompanyId ? (
          <SystemLink href={l.ghlCompany(client.ghlCompanyId)} missing="">
            View Company in Lead Alchemist
          </SystemLink>
        ) : (
          laConnected && (
            <form action={addToLeadAlchemistAction}>
              <input type="hidden" name="id" value={client.id} />
              <button className="btn-secondary" title="Link the Lead Alchemist Company with the same name, or create it. Contacts can be added to it any time.">
                Add Company to Lead Alchemist
              </button>
            </form>
          )
        )}
        <SystemLink href={l.ghlContact(ghlContactId)} missing="Not linked to a Lead Alchemist contact yet.">
          View primary contact in Lead Alchemist
        </SystemLink>
        {client.sfAccountId && (
          <form action={refreshFromSalesforceAction}>
            <input type="hidden" name="id" value={client.id} />
            <button className="btn-secondary" disabled={!sfConnected} title="Read the Salesforce Account and contacts. Nothing in AIS Connect is overwritten.">
              Refresh from Salesforce
            </button>
          </form>
        )}
        {laConnected && people.some((p) => p.ghlContactId) && (
          <form action={refreshContactsAction}>
            <input type="hidden" name="id" value={client.id} />
            <button className="btn-secondary" title="Read each linked contact's email and phone from Salesforce and Lead Alchemist">Check contact details</button>
          </form>
        )}
        <form action={syncClientAction}>
          <input type="hidden" name="id" value={client.id} />
          <button
            className="btn-secondary"
            disabled={!sfReady}
            title={sfReady ? "Send every submitted application to Salesforce now" : "Salesforce sync is off or not connected (Admin → Settings)"}
          >
            Send applications to Salesforce
          </button>
        </form>
      </div>

      <div className="mb-4">
        <AccountLifecycle
          client={client}
          back={`/admin/clients/${client.id}`}
          actions={{ deactivate: deactivateAccountAction, reactivate: reactivateAccountAction, relink: relinkAccountAction }}
        />
      </div>

      {alerts.length > 0 && (
        <div className="mb-4 rounded-lg border border-[var(--notice-border)] bg-[var(--notice-bg)] p-3 text-sm" role="alert">
          <p className="mb-1 font-semibold">Needs attention ({alerts.length})</p>
          <ul className="list-disc space-y-1 pl-5">
            {alerts.map(({ n }) => (
              <li key={n.id}>
                <Link className="btn-link" href={`/admin/notifications/${n.id}`}>{n.title}</Link>
                {n.detail && <span className="text-[var(--muted)]"> {n.detail}</span>}
              </li>
            ))}
          </ul>
        </div>
      )}

      {snap && (
        <section className="card mb-6 !p-5" aria-labelledby="sf-snap">
          <h2 id="sf-snap" className="mb-1 font-semibold">In Salesforce</h2>
          <p className="mb-3 text-xs text-[var(--muted)]">
            As read {client.sfPulledAt ? fmtDate(client.sfPulledAt) : ""}. Shown for comparison; edit these in Salesforce.
          </p>
          <dl className="grid gap-x-6 gap-y-2 text-sm sm:grid-cols-2 lg:grid-cols-3">
            {(
              [
                ["Name", snap.name, snap.name !== client.name],
                ["Phone", snap.phone, !!snap.phone && !client.phones.some((ph) => ph.replace(/\D/g, "").endsWith(snap.phone!.replace(/\D/g, "").slice(-10)))],
                ["Website", snap.website, false],
                ["Address", snap.address, false],
                ["Program", snap.program, false],
                ["Legal entity", snap.legalEntity, false],
                ["Policy effective", snap.effectiveDate, false],
                ["Policy expires", snap.expirationDate, false],
                ["Renewal status", snap.renewalStatus, false],
                ["Annual premium", snap.annualPremium != null ? `$${snap.annualPremium.toLocaleString("en-US")}` : null, false],
                ["Account owner", snap.ownerName, false],
              ] as [string, string | null, boolean][]
            ).map(([label, value, differs]) => (
              <div key={label}>
                <dt className="text-xs text-[var(--muted)]">{label}</dt>
                <dd>
                  {value || "—"}
                  {differs && <span className="badge badge-warning ml-2" title="Different from AIS Connect">Differs</span>}
                </dd>
              </div>
            ))}
          </dl>
        </section>
      )}

      {message && <p className="callout mb-4 text-sm" role="status">{message}</p>}
      <FlashMessage flash={flash} />
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
        <h2 id="contacts-heading" className="px-5 pt-4 font-semibold">Contacts ({people.length})</h2>
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
              return [
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
                    <ExternalValues email={p.sfEmail} phone={p.sfPhone} />
                    <SystemLink className="btn-link text-xs" href={l.salesforce("Contact", p.sfContactId)} missing="Not linked to a Salesforce Contact yet">
                      View Contact
                    </SystemLink>
                  </td>
                  <td className="text-sm">
                    {p.ghlContactId && <ExternalValues email={p.laEmail} phone={p.laPhone} />}
                    {p.ghlContactId ? (
                      <>
                        <SystemLink className="btn-link text-xs" href={l.ghlContact(p.ghlContactId)} missing="">
                          View Contact
                        </SystemLink>
                        {laConnected && (
                          <form action={updateLaContactAction} className="mt-1 flex flex-wrap gap-2">
                            <input type="hidden" name="contactId" value={p.id} />
                            <button className="btn-link text-xs" title="Fill the empty name, email, phone, company and address fields and add the links">
                              Update in Lead Alchemist
                            </button>
                            <button name="replace" value="yes" className="btn-link text-xs text-[var(--muted)]" title="Also replace Lead Alchemist values that differ from AIS Connect's">
                              (replace differences)
                            </button>
                          </form>
                        )}
                      </>
                    ) : laConnected ? (
                      <form action={addToLeadAlchemistAction}>
                        <input type="hidden" name="id" value={client.id} />
                        <input type="hidden" name="contactId" value={p.id} />
                        <button className="btn-link text-xs" title="Links the Lead Alchemist contact with this email or phone, or creates it; adds the Company first if needed and puts them in it">
                          Add to Lead Alchemist
                        </button>
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
              ,
                (diffs.get(p.id) ?? []).length > 0 && (
                  <tr key={`${p.id}-diff`}>
                    <td colSpan={6} className="!pt-0">
                      <div className="rounded-lg border border-[var(--notice-border)] bg-[var(--notice-bg)] p-2 text-xs">
                        {(diffs.get(p.id) ?? []).map((d) => (
                          <div key={d.field} className="flex flex-wrap items-center gap-2 py-1">
                            <span>
                              <strong>{d.field === "phone" ? "Phone" : "Email"}</strong> here is {d.value}; {d.differsFrom.map((x) => `${SOURCE_LABEL[x.source]} has ${x.value}`).join(", ")}.
                            </span>
                            {d.differsFrom.map((x) =>
                              x.source === "app" ? null : (
                                <form key={x.source} action={pushContactValueAction}>
                                  <input type="hidden" name="contactId" value={p.id} />
                                  <input type="hidden" name="target" value={x.source} />
                                  <input type="hidden" name="field" value={d.field} />
                                  <input type="hidden" name="value" value={d.value} />
                                  <button className="btn-secondary !px-2 !py-1 text-xs">Send {d.value} to {SOURCE_LABEL[x.source]}</button>
                                </form>
                              ),
                            )}
                          </div>
                        ))}
                      </div>
                    </td>
                  </tr>
                ),
              ];
            })}
            {!people.length && (
              <tr><td colSpan={6} className="py-6 text-center text-[var(--muted)]">No contacts yet.</td></tr>
            )}
          </tbody>
        </table>
      </section>

      <section className="card mb-6 overflow-x-auto !p-0" aria-labelledby="apps-heading">
        <h2 id="apps-heading" className="px-5 pt-4 font-semibold">Applications ({apps.length})</h2>
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
          <ListSummary total={eventTotal} state={activityPaging} noun="activity entry" />
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
          <Pagination
            total={eventTotal}
            state={activityPaging}
            noun="activity entry"
            href={pageHref(`/admin/clients/${client.id}`, {}, 25, "activity", "activity-heading")}
          />
        </section>
      </div>
    </div>
  );
}

/** A contact's email and phone as another system has them (read with "Refresh" / "Check contact details"). */
function ExternalValues({ email, phone }: { email: string | null; phone: string | null }) {
  if (!email && !phone) return null;
  return (
    <div className="mb-1 text-xs">
      {email && <div>{email}</div>}
      {phone && <div>{phone}</div>}
    </div>
  );
}
