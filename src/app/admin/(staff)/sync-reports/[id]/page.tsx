import Link from "next/link";
import { notFound } from "next/navigation";
import { requireStaff } from "@/lib/auth/session";
import { getSyncReport } from "@/lib/bulk/report";
import { SKIP_REASONS, skippedOf, type SkipReason } from "@/lib/bulk/tally";

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
  const t = report.contactCounts;
  const clean = report.done >= report.total && !report.errors.length && !report.conflicts.length && !report.skipped.length && (!t || (!t.failed && !skippedOf(t)));
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
      {t && (
        <section className="card mb-4 !p-4">
          <h2 className="mb-2 text-base font-semibold">Contacts</h2>
          <table className="text-sm">
            <tbody>
              <tr><td className="pr-4">Linked (already in Lead Alchemist) and in their Company</td><td className="font-semibold">{t.linked.toLocaleString("en-US")}</td></tr>
              <tr><td className="pr-4">Created in Lead Alchemist and put in their Company</td><td className="font-semibold">{t.created.toLocaleString("en-US")}</td></tr>
              {(Object.keys(SKIP_REASONS) as SkipReason[]).map((k) => (
                <tr key={k} className={t[k] ? "" : "text-[var(--muted)]"}>
                  <td className="pr-4">Skipped: {SKIP_REASONS[k]}</td>
                  <td className="font-semibold">{t[k].toLocaleString("en-US")}</td>
                </tr>
              ))}
              <tr className={t.failed ? "" : "text-[var(--muted)]"}><td className="pr-4">Failed</td><td className="font-semibold">{t.failed.toLocaleString("en-US")}</td></tr>
            </tbody>
          </table>
          <p className="mt-2 text-xs text-[var(--muted)]">Each account&apos;s own counts are in the lists below, one line per account.</p>
        </section>
      )}
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
