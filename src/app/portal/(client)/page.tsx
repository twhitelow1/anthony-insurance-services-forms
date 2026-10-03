import Link from "next/link";
import { forms } from "@/forms";
import { fmtDate, StatusBadge } from "@/components/portal";
import { requireClient } from "@/lib/auth/session";
import { listForEmail } from "@/lib/applications/repo";
import { STATUSES } from "@/lib/applications/status";

export const metadata = { title: "My applications | Anthony Insurance Services" };

export default async function PortalHome() {
  const client = await requireClient();
  const apps = await listForEmail(client.email);

  return (
    <div>
      <h1 className="mb-6 text-2xl font-semibold">My applications</h1>
      {apps.length === 0 && <p className="text-[var(--muted)]">We don&apos;t have any applications for {client.email}.</p>}
      <ul className="space-y-3">
        {apps.map((a) => (
          <li key={a.id}>
            <Link href={`/portal/applications/${a.id}`} className="card block !p-5 transition hover:border-[var(--accent)]">
              <div className="flex flex-wrap items-start justify-between gap-3">
                <div>
                  <p className="font-semibold">{a.businessName ?? forms[a.formSlug]?.title}</p>
                  <p className="text-sm text-[var(--muted)]">
                    {forms[a.formSlug]?.title} · <span className="font-mono">{a.reference}</span> · {fmtDate(a.createdAt)}
                  </p>
                </div>
                <StatusBadge status={a.status} />
              </div>
              <p className="mt-3 text-sm">{STATUSES[a.status].description}</p>
            </Link>
          </li>
        ))}
      </ul>
    </div>
  );
}
