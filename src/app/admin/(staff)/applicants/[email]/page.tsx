import Link from "next/link";
import { notFound } from "next/navigation";
import { forms } from "@/forms";
import { fmtDate, StatusBadge } from "@/components/portal";
import { requireStaff } from "@/lib/auth/session";
import { getApplicant, getApplication, listForEmail, normalizeEmail } from "@/lib/applications/repo";
import { linkGhlContactAction, unlinkGhlContactAction, userModeAction } from "@/app/admin/actions";
import { contactUrl, ghlConfig } from "@/lib/ghl/client";

export default async function Applicant({ params, searchParams }: PageProps<"/admin/applicants/[email]">) {
  const { email: raw } = await params;
  const { ghl: ghlMessage } = await searchParams;
  const email = normalizeEmail(decodeURIComponent(raw));
  await requireStaff(`/admin/applicants/${encodeURIComponent(email)}`);
  const apps = await listForEmail(email);
  if (!apps.length) notFound();
  // Contact details from their most recent application.
  const latest = await getApplication(apps[0].id);
  const phone = typeof latest?.values.phone === "string" ? latest.values.phone : null;
  const ghlContactId = (await getApplicant(email))?.ghlContactId ?? null;
  const ghlHref = ghlContactId ? contactUrl(ghlContactId) : null;

  return (
    <div>
      <Link href="/admin/applicants" className="btn-link">← All applicants</Link>
      <div className="mb-6 mt-3 flex flex-wrap items-start justify-between gap-4">
        <div>
          <h1 className="text-2xl font-semibold">{apps[0].applicantName}</h1>
          <p className="text-sm text-[var(--muted)]">
            <a className="btn-link" href={`mailto:${email}`}>{email}</a>
            {phone && <> · <a className="btn-link" href={`tel:${phone}`}>{phone}</a></>}
            {" "}· {apps.length} application{apps.length > 1 ? "s" : ""}
          </p>
        </div>
        <form action={userModeAction}>
          <input type="hidden" name="email" value={email} />
          <button className="btn-secondary">View portal as this applicant</button>
        </form>
      </div>
      <section className="card mb-6 !p-4" aria-labelledby="ghl-heading">
        <h2 id="ghl-heading" className="font-semibold">Lead Alchemist contact</h2>
        {typeof ghlMessage === "string" && (
          <p className="callout my-2 text-sm" role="status">{ghlMessage}</p>
        )}
        {ghlContactId ? (
          <div className="mt-1 flex flex-wrap items-center gap-3 text-sm">
            <span>
              Linked to <code className="text-xs">{ghlContactId}</code>. Every application from this email syncs to this contact,
              each as its own opportunity.
            </span>
            {ghlHref && <a className="btn-link" href={ghlHref} target="_blank" rel="noopener">Open in Lead Alchemist</a>}
            <form action={unlinkGhlContactAction}>
              <input type="hidden" name="email" value={email} />
              <button className="btn-link text-sm">Unlink</button>
            </form>
          </div>
        ) : (
          <p className="mt-1 text-sm text-[var(--muted)]">
            Not linked yet. The next sync matches the Lead Alchemist contact with this email, or link one now.
          </p>
        )}
        {ghlConfig() ? (
          <form action={linkGhlContactAction} className="mt-3 flex flex-wrap items-end gap-2">
            <input type="hidden" name="email" value={email} />
            <label className="grow text-sm">
              <span className="mb-1 block text-[var(--muted)]">Lead Alchemist contact ID or link (leave blank to find by email)</span>
              <input name="contactId" className="input" placeholder="e.g. 3fG7hK2mN9pQ…" />
            </label>
            <button className="btn-secondary">{ghlContactId ? "Re-link" : "Find in Lead Alchemist"}</button>
          </form>
        ) : (
          <p className="mt-2 text-sm text-[var(--muted)]">Lead Alchemist isn&apos;t connected (GHL_API_TOKEN / GHL_LOCATION_ID).</p>
        )}
      </section>
      <div className="card overflow-x-auto !p-0">
        <table className="data-table">
          <thead>
            <tr>
              <th>Reference</th>
              <th>Business</th>
              <th>Status</th>
              <th>Submitted</th>
              <th>PDF</th>
            </tr>
          </thead>
          <tbody>
            {apps.map((a) => (
              <tr key={a.id}>
                <td>
                  <Link className="row-link font-mono" href={`/admin/applications/${a.id}`}>{a.reference}</Link>
                </td>
                <td>
                  <div className="font-medium">{a.businessName ?? "—"}</div>
                  <div className="text-xs text-[var(--muted)]">{forms[a.formSlug]?.title ?? a.formSlug}</div>
                </td>
                <td><StatusBadge status={a.status} /></td>
                <td className="whitespace-nowrap text-sm">{fmtDate(a.createdAt)}</td>
                <td>
                  <a className="btn-link text-sm" href={`/applications/${a.id}/pdf`} target="_blank" rel="noopener">Open PDF</a>
                </td>
              </tr>
            ))}
          </tbody>
        </table>
      </div>
    </div>
  );
}
