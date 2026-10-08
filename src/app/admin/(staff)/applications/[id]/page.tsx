import Link from "next/link";
import { notFound } from "next/navigation";
import { getForm } from "@/forms";
import { Answers, fmtDate, StatusBadge, Timeline } from "@/components/portal";
import { requireStaff } from "@/lib/auth/session";
import { getApplication, getEvents } from "@/lib/applications/repo";
import { STATUSES, STATUS_KEYS } from "@/lib/applications/status";
import { answerSections } from "@/lib/forms/flatten";
import { AiReviewCard } from "@/components/AiReviewCard";
import { DOCUMENT_LABELS, listDocuments } from "@/lib/applications/documents";
import { applicantPath } from "@/lib/applications/links";
import {
  addNoteAction,
  deleteApplicationAction,
  regeneratePdfAction,
  resyncGhlAction,
  runAiReviewAction,
  updateStatusAction,
} from "../../../actions";

export default async function AdminApplication({ params, searchParams }: PageProps<"/admin/applications/[id]">) {
  const { id } = await params;
  const sp = await searchParams;
  await requireStaff(`/admin/applications/${id}`);
  const app = await getApplication(id);
  if (!app) notFound();
  const form = getForm(app.formSlug);
  const events = await getEvents(app.id);
  const aiEnabled = !!process.env.ANTHROPIC_API_KEY;
  const docs = await listDocuments(app.id);
  const ghlFailed = !app.ghlContactId && events.some((e) => e.type === "ghl_sync_failed");
  const pdfError = !docs.some((d) => d.kind === "carrier_form") ? events.find((e) => e.type === "pdf_failed") : undefined;

  return (
    <div>
      <Link href="/admin" className="btn-link">← All applications</Link>
      <div className="mb-6 mt-3 flex flex-wrap items-start justify-between gap-4">
        <div>
          <p className="font-mono text-sm text-[var(--muted)]">{app.reference}</p>
          <h1 className="text-2xl font-semibold">{app.businessName ?? app.applicantName}</h1>
          <p className="text-sm text-[var(--muted)]">
            {form?.title ?? app.formSlug} · submitted {fmtDate(app.createdAt)} · {app.applicantName} ·{" "}
            <a className="btn-link" href={`mailto:${app.applicantEmail}`}>{app.applicantEmail}</a>
          </p>
          <p className="mt-1 text-sm">
            <Link className="btn-link" href={applicantPath(app.applicantEmail)}>All applications from this applicant</Link>
          </p>
        </div>
        <div className="flex flex-wrap items-center gap-3">
          <StatusBadge status={app.status} />
          <Link className="btn-secondary" href={`/admin/applications/${app.id}/edit`}>Edit answers</Link>
        </div>
      </div>
      {sp.saved === "1" && (
        <p className="callout mb-6 text-sm" role="status">Changes saved. The PDFs are being rebuilt; refresh in a moment to see them.</p>
      )}

      <div className="grid gap-6 lg:grid-cols-[minmax(0,1fr)_360px]">
        <div className="order-2 space-y-6 lg:order-1">
        <section className="card" aria-labelledby="ai-review-heading">
          <div className="mb-3 flex flex-wrap items-center justify-between gap-2">
            <h2 id="ai-review-heading" className="font-semibold">AI pre-review</h2>
            {aiEnabled && (
              <form action={runAiReviewAction}>
                <input type="hidden" name="id" value={app.id} />
                <button className="btn-link">{app.aiReview ? "Re-run review" : "Run review"}</button>
              </form>
            )}
          </div>
          {app.aiReview ? (
            <AiReviewCard review={app.aiReview} />
          ) : (
            <p className="text-sm text-[var(--muted)]">
              {aiEnabled ? "No review yet — it runs automatically on new submissions, or run it now." : "AI isn't set up yet (ANTHROPIC_API_KEY)."}
            </p>
          )}
        </section>
        <div className="card">
          {form ? <Answers sections={answerSections(form, app.values)} /> : <pre className="text-xs">{JSON.stringify(app.values, null, 2)}</pre>}
          {app.signature && (
            <section className="mt-6">
              <h3 className="mb-2 text-sm font-semibold uppercase tracking-wider text-[var(--accent-strong)]">Signature</h3>
              {/* eslint-disable-next-line @next/next/no-img-element -- data URL, nothing to optimize */}
              <img src={app.signature} alt={`Signature of ${app.applicantName}`} className="max-h-40 rounded-lg border border-[var(--border)] bg-white" />
              <p className="mt-1 text-xs text-[var(--muted)]">
                Signed electronically {fmtDate(app.createdAt)} from IP {app.submittedIp ?? "unknown"}
              </p>
            </section>
          )}
        </div>
        </div>

        <aside className="order-1 space-y-6 lg:order-2">
          <form action={updateStatusAction} className="card space-y-3 !p-5">
            <h2 className="font-semibold">Update status</h2>
            <input type="hidden" name="id" value={app.id} />
            <label className="sr-only" htmlFor="status">Status</label>
            <select id="status" name="status" defaultValue={app.status} className="input">
              {STATUS_KEYS.map((s) => (
                <option key={s} value={s}>{STATUSES[s].label}</option>
              ))}
            </select>
            <label className="sr-only" htmlFor="note">Note for the client</label>
            <textarea id="note" name="note" rows={3} className="input" placeholder="Optional note — the client will see this" />
            <label className="flex items-center gap-2 text-sm">
              <input type="checkbox" name="notify" defaultChecked /> Email the client about this update
            </label>
            <button className="btn-primary w-full">Save status</button>
          </form>

          <form action={addNoteAction} className="card space-y-3 !p-5">
            <h2 className="font-semibold">Add a note</h2>
            <input type="hidden" name="id" value={app.id} />
            <label className="sr-only" htmlFor="message">Note</label>
            <textarea id="message" name="message" rows={3} className="input" required placeholder="Internal note" />
            <label className="flex items-center gap-2 text-sm">
              <input type="checkbox" name="clientVisible" /> Show this note to the client
            </label>
            <button className="btn-secondary w-full">Add note</button>
          </form>

          <div className="card space-y-3 !p-5">
            <h2 className="font-semibold">Application PDFs</h2>
            {pdfError && (
              <p className="rounded-lg bg-[var(--danger-bg)] p-3 text-sm text-[var(--danger)]" role="alert">
                The PDF couldn&apos;t be created: {pdfError.message}
              </p>
            )}
            <p className="text-sm">
              <a className="btn-link font-medium" href={`/applications/${app.id}/pdf`} target="_blank" rel="noopener">
                Open current PDF
              </a>
              <span className="block text-xs text-[var(--muted)]">This link always opens the newest version. It&apos;s the one saved in Lead Alchemist.</span>
            </p>
            {docs.length ? (
              <ul className="space-y-2 text-sm">
                {["carrier_form", "application_pdf"].map((kind) => {
                  const versions = docs.filter((d) => d.kind === kind);
                  if (!versions.length) return null;
                  const [latest, ...older] = versions;
                  return (
                    <li key={kind}>
                      <a className="btn-link" href={`/documents/${latest.id}`} target="_blank" rel="noopener">
                        {DOCUMENT_LABELS[kind]}
                      </a>{" "}
                      <span className="text-xs text-[var(--muted)]">
                        {fmtDate(latest.createdAt)} · {Math.round(latest.size / 1024)} KB
                      </span>
                      {older.length > 0 && (
                        <span className="block text-xs text-[var(--muted)]">
                          Earlier:{" "}
                          {older.map((d, i) => (
                            <a key={d.id} className="btn-link" href={`/documents/${d.id}`} target="_blank" rel="noopener">
                              {i ? ", " : ""}
                              {fmtDate(d.createdAt)}
                            </a>
                          ))}
                        </span>
                      )}
                    </li>
                  );
                })}
              </ul>
            ) : (
              <p className="text-sm text-[var(--muted)]">No PDF yet.</p>
            )}
            <form action={regeneratePdfAction}>
              <input type="hidden" name="id" value={app.id} />
              <button className="btn-secondary w-full">{docs.length ? "Create PDFs again" : "Create PDFs"}</button>
            </form>
          </div>

          <div className="card space-y-3 !p-5">
            <h2 className="font-semibold">Send to carrier</h2>
            <p className="text-sm text-[var(--muted)]">
              Downloads an Outlook draft with the filled carrier application attached and the encryption tag in the subject. Open it, check it, and press Send.
            </p>
            <a className="btn-primary w-full" href={`/api/admin/applications/${app.id}/carrier`}>Prepare carrier email</a>
          </div>

          <details id="delete" className="card !p-5" open={sp.deleteError === "1"}>
            <summary className="cursor-pointer font-semibold text-[var(--danger)]">Delete application</summary>
            <form action={deleteApplicationAction} className="mt-3 space-y-3">
              <input type="hidden" name="id" value={app.id} />
              <p className="text-sm text-[var(--muted)]">
                This permanently deletes the application, its PDFs and its activity log. The Lead Alchemist contact isn&apos;t touched.
              </p>
              <label className="block text-sm" htmlFor="confirm">
                Type <span className="font-mono font-semibold">{app.reference}</span> to confirm
              </label>
              <input id="confirm" name="confirm" className="input" autoComplete="off" required />
              {sp.deleteError === "1" && <p className="text-sm text-[var(--danger)]">That didn&apos;t match the reference.</p>}
              <button className="btn-secondary w-full !border-[var(--danger)] !text-[var(--danger)]">Delete permanently</button>
            </form>
          </details>

          <div className="card !p-5">
            <h2 className="mb-2 font-semibold">Lead Alchemist</h2>
            {app.ghlContactId ? (
              <p className="text-sm">
                Linked to contact <span className="font-mono">{app.ghlContactId}</span>
                {app.ghlOpportunityId && (
                  <>
                    {" "}and opportunity <span className="font-mono">{app.ghlOpportunityId}</span>
                  </>
                )}
              </p>
            ) : (
              <p className="text-sm text-[var(--muted)]">{ghlFailed ? "Sync failed — see activity below." : "Not linked yet."}</p>
            )}
            <form action={resyncGhlAction} className="mt-3">
              <input type="hidden" name="id" value={app.id} />
              <button className="btn-secondary w-full">{app.ghlContactId ? "Re-sync contact" : "Sync to Lead Alchemist"}</button>
            </form>
          </div>

          <div className="card !p-5">
            <h2 className="mb-4 font-semibold">Activity</h2>
            <Timeline events={events} audience="staff" />
          </div>
        </aside>
      </div>
    </div>
  );
}
