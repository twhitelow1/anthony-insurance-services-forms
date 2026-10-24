import type { ReactNode } from "react";
import type { ApplicationSfStatus, SalesforceStatus } from "@/lib/db/schema";

/** Opens a record in another system; disabled with an explanation when the record doesn't exist yet. */
export function SystemLink({ href, children, missing, className = "btn-secondary" }: { href: string | null; children: ReactNode; missing: string; className?: string }) {
  if (!href) {
    return (
      <span className={`${className} cursor-not-allowed opacity-50`} aria-disabled="true" title={missing} tabIndex={0}>
        {children}
      </span>
    );
  }
  return (
    <a className={className} href={href} target="_blank" rel="noopener">
      {children}
    </a>
  );
}

const SF_LABELS: Record<SalesforceStatus | ApplicationSfStatus, { label: string; tone: string }> = {
  not_synced: { label: "Not synced", tone: "badge-neutral" },
  linked: { label: "Linked", tone: "badge-success" },
  synced: { label: "Synced", tone: "badge-success" },
  pending: { label: "Queued", tone: "badge-active" },
  needs_review: { label: "Needs review", tone: "badge-warning" },
  error: { label: "Sync failed", tone: "badge-danger" },
  skipped: { label: "Not sent", tone: "badge-neutral" },
  create_confirmed: { label: "New Account queued", tone: "badge-active" },
};

export function SalesforceBadge({ status, title }: { status: SalesforceStatus | ApplicationSfStatus; title?: string | null }) {
  const s = SF_LABELS[status] ?? SF_LABELS.not_synced;
  return (
    <span className={`badge ${s.tone}`} title={title ?? undefined}>
      {s.label}
    </span>
  );
}
