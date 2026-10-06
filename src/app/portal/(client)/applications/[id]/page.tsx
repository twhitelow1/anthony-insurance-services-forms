import Link from "next/link";
import { notFound } from "next/navigation";
import { getForm } from "@/forms";
import { Answers, fmtDate, StatusBadge, Timeline } from "@/components/portal";
import { requirePortalViewer } from "@/lib/auth/session";
import { getApplication, getEvents } from "@/lib/applications/repo";
import { STATUSES } from "@/lib/applications/status";
import { answerSections } from "@/lib/forms/flatten";
import { mainDocument } from "@/lib/applications/documents";

export default async function ClientApplication({ params }: PageProps<"/portal/applications/[id]">) {
  const client = await requirePortalViewer();
  const { id } = await params;
  const app = await getApplication(id);
  // Same 404 whether it doesn't exist or belongs to someone else.
  if (!app || app.applicantEmail !== client.email) notFound();
  const form = getForm(app.formSlug);
  const events = await getEvents(app.id, { clientOnly: true });
  const pdf = await mainDocument(app.id);

  return (
    <div className="space-y-6">
      <Link href="/portal" className="btn-link">← My applications</Link>
      <div className="card">
        <div className="flex flex-wrap items-start justify-between gap-3">
          <div>
            <p className="font-mono text-sm text-[var(--muted)]">{app.reference}</p>
            <h1 className="text-2xl font-semibold">{app.businessName ?? form?.title}</h1>
            <p className="text-sm text-[var(--muted)]">{form?.title} · submitted {fmtDate(app.createdAt)}</p>
          </div>
          <StatusBadge status={app.status} />
        </div>
        <p className="callout mt-4">{STATUSES[app.status].description}</p>
        {pdf && (
          <a className="btn-secondary mt-4" href={`/applications/${app.id}/pdf?download=1`}>
            Download your application (PDF)
          </a>
        )}
      </div>

      <div className="card">
        <h2 className="mb-4 font-semibold">Updates</h2>
        <Timeline events={events} audience="client" />
      </div>

      {form && (
        <details className="card">
          <summary className="cursor-pointer font-semibold">Your answers</summary>
          <div className="mt-4">
            <Answers sections={answerSections(form, app.values)} />
          </div>
        </details>
      )}
      <p className="text-center text-sm text-[var(--muted)]">
        Questions? Reply to any email from us or call your Anthony Insurance Services agent.
      </p>
    </div>
  );
}
