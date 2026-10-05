import type { ReactNode } from "react";
import type { ApplicationEvent } from "@/lib/db/schema";
import { STATUSES, isStatus, type ApplicationStatus } from "@/lib/applications/status";
import type { AnswerSection } from "@/lib/forms/flatten";

export const fmtDate = (d: Date | string) =>
  new Date(d).toLocaleString("en-US", {
    dateStyle: "medium",
    timeStyle: "short",
    timeZone: process.env.APP_TIMEZONE ?? "America/Chicago",
  });

export function StatusBadge({ status }: { status: ApplicationStatus }) {
  const s = STATUSES[status];
  return <span className={`badge badge-${s.tone}`}>{s.label}</span>;
}

const EVENT_LABEL: Record<string, string> = {
  submitted: "Submitted",
  status_changed: "Status changed",
  staff_note: "Note",
  ghl_synced: "GoHighLevel",
  ghl_sync_failed: "GoHighLevel sync failed",
  email_sent: "Email",
  email_failed: "Email failed",
  ai_reviewed: "AI review",
  ai_review_failed: "AI review failed",
  carrier_email_prepared: "Carrier email",
  pdf_created: "PDF",
  pdf_failed: "PDF failed",
};

export function Timeline({ events, audience }: { events: ApplicationEvent[]; audience: "staff" | "client" }) {
  if (!events.length) return <p className="text-sm text-[var(--muted)]">No activity yet.</p>;
  return (
    <ol className="timeline">
      {events.map((e) => {
        const to = e.type === "status_changed" && isStatus(e.data?.to) ? e.data.to : undefined;
        const failed = e.type.endsWith("_failed");
        return (
          <li key={e.id} className={failed ? "is-failed" : to ? `tone-${STATUSES[to].tone}` : ""}>
            <div className="flex flex-wrap items-baseline gap-x-2">
              <span className="font-medium">{to ? STATUSES[to].label : EVENT_LABEL[e.type] ?? e.type}</span>
              <time className="text-xs text-[var(--muted)]">{fmtDate(e.createdAt)}</time>
            </div>
            {e.message && <p className="mt-0.5 whitespace-pre-line text-sm">{e.message}</p>}
            {audience === "staff" && (
              <p className="mt-0.5 text-xs text-[var(--muted)]">
                {e.actor.replace(/^(staff|client):/, "")}
                {e.clientVisible ? " · visible to client" : ""}
              </p>
            )}
          </li>
        );
      })}
    </ol>
  );
}

export function Answers({ sections }: { sections: AnswerSection[] }) {
  return (
    <div className="space-y-6">
      {sections.map((s) => (
        <section key={s.title}>
          <h3 className="mb-2 text-sm font-semibold uppercase tracking-wider text-[var(--accent-strong)]">{s.title}</h3>
          <dl className="answers">
            {s.rows.map((r, i) => (
              <div key={i}>
                <dt>
                  {r.group && <span className="block text-xs text-[var(--muted)]">{r.group}</span>}
                  {r.label}
                </dt>
                <dd>{r.value}</dd>
              </div>
            ))}
          </dl>
        </section>
      ))}
    </div>
  );
}

export function TopBar({ title, href, who, children }: { title: string; href: string; who?: string; children?: ReactNode }) {
  return (
    <header className="border-b border-[var(--border)] bg-[var(--surface)]">
      <div className="mx-auto flex w-full max-w-6xl flex-wrap items-center justify-between gap-3 px-4 py-3">
        <a href={href} className="flex flex-col leading-tight">
          <span className="text-[11px] font-semibold uppercase tracking-[0.18em] text-[var(--accent-strong)]">Anthony Insurance Services</span>
          <span className="font-semibold text-[var(--brand)]">{title}</span>
        </a>
        <div className="flex items-center gap-3 text-sm">
          {children}
          {who && <span className="hidden text-[var(--muted)] sm:inline">{who}</span>}
          {who && (
            <form action="/api/auth/logout" method="post">
              <button className="btn-link">Sign out</button>
            </form>
          )}
        </div>
      </div>
    </header>
  );
}
