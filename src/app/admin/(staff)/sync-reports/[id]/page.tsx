import Link from "next/link";
import { notFound } from "next/navigation";
import { requireStaff } from "@/lib/auth/session";
import { getSyncReport } from "@/lib/bulk/report";

export const metadata = { title: "Sync report | AIS Connect" };
export const dynamic = "force-dynamic";

function Section({ title, items, tone, hint }: { title: string; items: string[]; tone: string; hint: string }) {
  if (!items.length) return null;
  return (
    <section className="card mb-4 !p-4">
      <h2 className="mb-1 text-base font-semibold">
        <span className={`badge ${tone} mr-2`}>{items.length}</span>
        {title}
      </h2>
      <p className="mb-2 text-sm text-[var(--muted)]">{hint}</p>
      <ul className="list-disc space-y-1 pl-5 text-sm">
        {items.map((t, i) => (
          <li key={i}>{t}</li>
        ))}
      </ul>
    </section>
  );
}

/** One bulk sync's full result. */
export default async function SyncReportPage({ params }: PageProps<"/admin/sync-reports/[id]">) {
  await requireStaff("/admin/sync-reports");
  const report = await getSyncReport((await params).id);
  if (!report) notFound();
  const clean = report.done >= report.total && !report.errors.length && !report.conflicts.length;
  return (
    <div>
      <p className="mb-2 text-sm">
        <Link className="btn-link" href="/admin/sync-reports">← Sync reports</Link>
      </p>
      <h1 className="mb-1 text-2xl font-semibold">{report.title}</h1>
      <p className="mb-4 text-sm text-[var(--muted)]">
        {report.scope} · {report.actor.replace(/^staff:/, "")} ·{" "}
        {report.createdAt.toLocaleString("en-US", { timeZone: process.env.APP_TIMEZONE ?? "America/Chicago" })}
        {report.page && (
          <>
            {" "}
            · <Link className="btn-link" href={report.page}>Back to the list</Link>
          </>
        )}
      </p>
      <section className={`mb-4 rounded-lg border p-4 ${clean ? "border-[var(--border)]" : "border-[var(--notice-border)] bg-[var(--notice-bg)]"}`} role="status">
        <p className="text-lg font-semibold">
          {clean ? "✓ Everything synced" : "⚠ Needs attention"}: {report.done} of {report.total} done
        </p>
        <p className="text-sm">
          {report.conflicts.length} conflict{report.conflicts.length === 1 ? "" : "s"} · {report.errors.length} error{report.errors.length === 1 ? "" : "s"} ·{" "}
          {report.skipped.length} skipped note{report.skipped.length === 1 ? "" : "s"}
        </p>
      </section>
      <Section title="Errors" items={report.errors} tone="badge-danger" hint="These didn't sync. Fix the cause (often a connection, a permission or a deleted record) and run it again for these rows." />
      <Section
        title="Conflicts"
        items={report.conflicts}
        tone="badge-warning"
        hint="AIS Connect stopped instead of guessing, so nothing was duplicated: for example two records with the same name, or a record already linked elsewhere. Pick the right one (account page or Mapping) and sync again."
      />
      <Section title="Skipped or not done" items={report.skipped} tone="badge-neutral" hint="Rows that weren't reached or don't apply to this action yet (for example not in AIS Connect yet)." />
      <Section title="Other notes" items={report.notes} tone="badge-neutral" hint="For information; nothing to fix." />
    </div>
  );
}
