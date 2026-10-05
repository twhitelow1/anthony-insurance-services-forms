import Link from "next/link";
import { notFound } from "next/navigation";
import { getForm } from "@/forms";
import { Answers, fmtDate, StatusBadge, Timeline } from "@/components/portal";
import { requireStaff } from "@/lib/auth/session";
import { getApplication, getEvents } from "@/lib/applications/repo";
import { STATUSES, STATUS_KEYS } from "@/lib/applications/status";
import { answerSections } from "@/lib/forms/flatten";
import { AiReviewCard } from "@/components/AiReviewCard";
import { addNoteAction, resyncGhlAction, runAiReviewAction, updateStatusAction } from "../../../actions";

export default async function AdminApplication({ params }: PageProps<"/admin/applications/[id]">) {
  const { id } = await params;
  await requireStaff(`/admin/applications/${id}`);
  const app = await getApplication(id);
  if (!app) notFound();
  const form = getForm(app.formSlug);
  const events = await getEvents(app.id);
  const aiEnabled = !!process.env.ANTHROPIC_API_KEY;
  const ghlFailed = !app.ghlContactId && events.some((e) => e.type === "ghl_sync_failed");

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
        </div>
        <StatusBadge status={app.status} />
      </div>

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

          <div className="card !p-5">
            <h2 className="mb-2 font-semibold">GoHighLevel</h2>
            {app.ghlContactId ? (
              <p className="text-sm">Linked to contact <span className="font-mono">{app.ghlContactId}</span></p>
            ) : (
              <p className="text-sm text-[var(--muted)]">{ghlFailed ? "Sync failed — see activity below." : "Not linked yet."}</p>
            )}
            <form action={resyncGhlAction} className="mt-3">
              <input type="hidden" name="id" value={app.id} />
              <button className="btn-secondary w-full">{app.ghlContactId ? "Re-sync contact" : "Sync to GoHighLevel"}</button>
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
