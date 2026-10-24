import Link from "next/link";
import { notFound } from "next/navigation";
import { SystemLink } from "@/components/clients";
import { requireStaff } from "@/lib/auth/session";
import { listAccountContacts } from "@/lib/clients/repo";
import { readFlash } from "@/lib/flash";
import { ghlConfig } from "@/lib/ghl/client";
import { laCandidates, laName, type LaCandidate } from "@/lib/ghl/match";
import { links } from "@/lib/integrations/links";
import { salesforceClient } from "@/lib/salesforce/client";
import { contactBlockers, salesforceAccountDetail } from "@/lib/salesforce/manager";
import {
  createLaContactAction,
  linkExactLaMatchesAction,
  linkLaContactAction,
  deactivateAccountAction,
  reactivateAccountAction,
  relinkAccountAction,
  removeContactAction,
  resumeAccountAction,
  syncAccountAction,
  syncContactAction,
  unlinkLaContactAction,
  unsyncAccountAction,
  unsyncContactAction,
} from "../actions";
import { AccountLifecycle, ActionButton, AppStateBadge, FlashMessage, RemoveForm } from "../ui";

export const metadata = { title: "Salesforce Account | Anthony Insurance Services" };
export const dynamic = "force-dynamic";

const SF_ID = /^[A-Za-z0-9]{15,18}$/;
const HOW: Record<LaCandidate["how"][number], string> = { email: "same email", phone: "same phone", name: "similar name (check)" };

export default async function SalesforceAccount({ params, searchParams }: PageProps<"/admin/salesforce/[id]">) {
  const { id } = await params;
  await requireStaff(`/admin/salesforce/${id}`);
  if (!SF_ID.test(id)) notFound();
  const sp = await searchParams;
  const flash = await readFlash(sp.f);
  const sf = await salesforceClient();
  const l = await links();
  const back = `/admin/salesforce/${id}`;

  if (!sf) {
    return (
      <p className="callout callout-notice">
        Salesforce isn&apos;t connected. Add the keys in <Link className="btn-link" href="/admin/settings/integrations">Settings → Integrations</Link>.
      </p>
    );
  }
  let detail: Awaited<ReturnType<typeof salesforceAccountDetail>>;
  try {
    detail = await salesforceAccountDetail(sf, id);
  } catch (err) {
    return (
      <div>
        <Link href="/admin/salesforce" className="btn-link">← Salesforce Accounts</Link>
        <FlashMessage flash={flash} />
        <p className="mt-4 rounded-lg bg-[var(--danger-bg)] p-3 text-sm text-[var(--danger)]" role="alert">
          {err instanceof Error ? err.message : String(err)}
        </p>
      </div>
    );
  }
  const { account, client, accountState, contacts } = detail;
  const contactBlocks = new Map<string, Awaited<ReturnType<typeof contactBlockers>>>();
  for (const c of contacts) if (c.contact) contactBlocks.set(c.contact.id, await contactBlockers(c.contact.id));

  // Lead Alchemist matching for everyone on the Account in this app.
  const laOn = !!(await ghlConfig());
  const people = client ? await listAccountContacts(client.id) : [];
  const find = typeof sp.find === "string" ? sp.find : null;
  const candidates = new Map<string, LaCandidate[] | string>();
  if (laOn && find) {
    for (const p of people.filter((p) => !p.ghlContactId && (find === "all" || p.id === find)).slice(0, 25)) {
      try {
        candidates.set(p.id, await laCandidates(p));
      } catch (err) {
        candidates.set(p.id, err instanceof Error ? err.message : String(err));
      }
    }
  }
  const unlinked = people.filter((p) => !p.ghlContactId);
  const address = [account.BillingStreet, account.BillingCity, account.BillingState, account.BillingPostalCode].filter(Boolean).join(", ");

  return (
    <div>
      <Link href="/admin/salesforce" className="btn-link">← Salesforce Accounts</Link>
      <div className="mb-2 mt-3 flex flex-wrap items-center gap-3">
        <h1 className="text-2xl font-semibold">{account.Name}</h1>
        <AppStateBadge state={accountState} />
      </div>
      <p className="mb-4 text-sm text-[var(--muted)]">
        {[account.Phone, account.Website, address].filter(Boolean).join(" · ") || "No phone, website or address in Salesforce."}
      </p>
      <FlashMessage flash={flash} />

      <section className="card mb-6 space-y-3 !p-5" aria-labelledby="acct">
        <h2 id="acct" className="font-semibold">This Account</h2>
        <div className="flex flex-wrap gap-2">
          {client ? (
            <>
              <Link className="btn-secondary" href={`/admin/clients/${client.id}`}>Open in this app</Link>
              {accountState === "deactivated" ? null : accountState === "synced" ? (
                <>
                  <ActionButton action={syncAccountAction} fields={{ sfAccountId: id, back }}>Sync now</ActionButton>
                  <ActionButton action={unsyncAccountAction} fields={{ clientId: client.id, back }}>Unsync</ActionButton>
                </>
              ) : (
                <ActionButton action={resumeAccountAction} fields={{ clientId: client.id, back }} className="btn-primary">Sync again</ActionButton>
              )}
            </>
          ) : (
            <ActionButton action={syncAccountAction} fields={{ sfAccountId: id, back }} className="btn-primary">
              Sync into this app
            </ActionButton>
          )}
          <SystemLink href={l.salesforce("Account", id)} missing="Add the Lightning URL in Settings → Integrations">View in Salesforce</SystemLink>
          {client?.ghlCompanyId && <SystemLink href={l.ghlCompany(client.ghlCompanyId)} missing="">View Company in Lead Alchemist</SystemLink>}
        </div>
        {client && (
          <AccountLifecycle
            client={client}
            back={back}
            actions={{ deactivate: deactivateAccountAction, reactivate: reactivateAccountAction, relink: relinkAccountAction }}
          />
        )}
      </section>

      <section className="mb-6" aria-labelledby="sfc">
        <h2 id="sfc" className="mb-2 font-semibold">Salesforce Contacts ({contacts.length})</h2>
        <div className="overflow-x-auto">
          <table className="data-table">
            <thead>
              <tr>
                <th>Contact</th>
                <th>In this app</th>
                <th>Actions</th>
              </tr>
            </thead>
            <tbody>
              {!contacts.length && (
                <tr>
                  <td colSpan={3} className="text-[var(--muted)]">No Contacts on this Account in Salesforce.</td>
                </tr>
              )}
              {contacts.map((c) => {
                const b = c.contact ? contactBlocks.get(c.contact.id) : undefined;
                return (
                  <tr key={c.id}>
                    <td>
                      <div className="font-medium">{c.name}</div>
                      <div className="text-xs text-[var(--muted)]">{[c.title, c.email, c.phone].filter(Boolean).join(" · ")}</div>
                    </td>
                    <td>
                      <AppStateBadge state={c.appState} />
                    </td>
                    <td>
                      <div className="flex flex-wrap items-start gap-2">
                        {c.appState === "synced" && c.contact && (
                          <ActionButton action={unsyncContactAction} fields={{ contactId: c.contact.id, back }}>Unsync</ActionButton>
                        )}
                        {c.appState !== "synced" && client && (
                          <ActionButton action={syncContactAction} fields={{ sfContactId: c.id, back }} className="btn-primary">
                            {c.appState === "unsynced" ? "Sync again" : "Sync"}
                          </ActionButton>
                        )}
                        <SystemLink href={l.salesforce("Contact", c.id)} missing="Add the Lightning URL in Settings → Integrations">View in Salesforce</SystemLink>
                        {c.contact && b && !b.applications && !b.drafts && (
                          <RemoveForm
                            action={removeContactAction}
                            fields={{ contactId: c.contact.id, back }}
                            label="Remove from this app"
                            stays={`Deletes ${c.contact.name} from this app only. They stay in Salesforce and Lead Alchemist; delete them there if they should go.`}
                          />
                        )}
                        {c.contact && b && (b.applications > 0 || b.drafts > 0) && (
                          <span className="text-xs text-[var(--muted)]">Filled out applications here, so can&apos;t be removed (unsync instead).</span>
                        )}
                      </div>
                    </td>
                  </tr>
                );
              })}
            </tbody>
          </table>
        </div>
        {!client && contacts.length > 0 && <p className="mt-2 text-sm text-[var(--muted)]">Sync the Account to bring its Contacts in.</p>}
      </section>

      {client && (
        <section aria-labelledby="la">
          <div className="mb-2 flex flex-wrap items-center justify-between gap-2">
            <h2 id="la" className="font-semibold">Lead Alchemist contacts ({people.length})</h2>
            {laOn && unlinked.length > 0 && (
              <div className="flex flex-wrap gap-2">
                <Link className="btn-secondary" href={`?find=all#la`}>Find all in Lead Alchemist</Link>
                <ActionButton action={linkExactLaMatchesAction} fields={{ contactIds: unlinked.map((p) => p.id).join(","), back }}>
                  Link exact email/phone matches
                </ActionButton>
              </div>
            )}
          </div>
          <p className="mb-3 text-sm text-[var(--muted)]">
            Matches each person here to their Lead Alchemist contact by email or phone. Linking saves the connection in this app; it doesn&apos;t
            change the Lead Alchemist contact.
          </p>
          {!laOn ? (
            <p className="callout callout-notice">
              Lead Alchemist isn&apos;t connected. Add the keys in <Link className="btn-link" href="/admin/settings/integrations">Settings → Integrations</Link>.
            </p>
          ) : (
            <div className="overflow-x-auto">
              <table className="data-table">
                <thead>
                  <tr>
                    <th>Person in this app</th>
                    <th>Lead Alchemist</th>
                  </tr>
                </thead>
                <tbody>
                  {!people.length && (
                    <tr>
                      <td colSpan={2} className="text-[var(--muted)]">No contacts on this Account yet.</td>
                    </tr>
                  )}
                  {people.map((p) => {
                    const found = candidates.get(p.id);
                    return (
                      <tr key={p.id}>
                        <td>
                          <div className="font-medium">{p.name}</div>
                          <div className="text-xs text-[var(--muted)]">{[p.primaryEmail, p.phones[0]].filter(Boolean).join(" · ")}</div>
                        </td>
                        <td>
                          {p.ghlContactId ? (
                            <div className="flex flex-wrap gap-2">
                              <span className="badge badge-success">Linked</span>
                              <SystemLink href={l.ghlContact(p.ghlContactId)} missing="Add the location ID in Settings → Integrations">Open in Lead Alchemist</SystemLink>
                              <ActionButton action={unlinkLaContactAction} fields={{ contactId: p.id, back }}>Unlink here</ActionButton>
                            </div>
                          ) : typeof found === "string" ? (
                            <span className="text-sm text-[var(--danger)]">Lead Alchemist search failed: {found}</span>
                          ) : found ? (
                            <div className="space-y-2">
                              {found.map((cand) => (
                                <div key={cand.contact.id} className="flex flex-wrap items-center gap-2 text-sm">
                                  <span>
                                    <strong>{laName(cand.contact)}</strong>
                                    {cand.contact.email && ` · ${cand.contact.email}`}
                                    {cand.contact.phone && ` · ${cand.contact.phone}`}
                                  </span>
                                  <span className={`badge ${cand.how.some((h) => h !== "name") ? "badge-success" : "badge-warning"}`}>
                                    {cand.how.map((h) => HOW[h]).join(", ")}
                                  </span>
                                  <ActionButton action={linkLaContactAction} fields={{ contactId: p.id, ghlContactId: cand.contact.id, back }}>Link</ActionButton>
                                  <SystemLink href={l.ghlContact(cand.contact.id)} missing="" className="btn-link">View</SystemLink>
                                </div>
                              ))}
                              {!found.some((c) => c.how.some((h) => h !== "name")) && (
                                <div className="flex flex-wrap items-center gap-2 text-sm">
                                  <span className="text-[var(--muted)]">{found.length ? "No email or phone match." : "Not found in Lead Alchemist."}</span>
                                  <ActionButton action={createLaContactAction} fields={{ contactId: p.id, back }}>Create in Lead Alchemist</ActionButton>
                                </div>
                              )}
                            </div>
                          ) : (
                            <Link className="btn-secondary" href={`?find=${p.id}#la`}>Find in Lead Alchemist</Link>
                          )}
                        </td>
                      </tr>
                    );
                  })}
                </tbody>
              </table>
            </div>
          )}
        </section>
      )}
    </div>
  );
}
