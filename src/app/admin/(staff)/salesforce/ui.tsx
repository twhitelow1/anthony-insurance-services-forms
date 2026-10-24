import type { ReactNode } from "react";
import type { AppState } from "@/lib/salesforce/manager";
import type { Flash } from "@/lib/flash";

const STATE: Record<AppState, { label: string; tone: string; title: string }> = {
  not_in_app: { label: "Not in this app", tone: "badge-neutral", title: "Only in Salesforce. Sync to bring it in." },
  synced: { label: "Synced", tone: "badge-success", title: "In this app and kept in sync with Salesforce." },
  unsynced: { label: "Unsynced", tone: "badge-warning", title: "In this app, but not syncing either way." },
  removed: { label: "Removed here", tone: "badge-neutral", title: "Removed from this app; still in Salesforce. Sync to bring it back." },
};

export function AppStateBadge({ state }: { state: AppState }) {
  const s = STATE[state];
  return (
    <span className={`badge ${s.tone}`} title={s.title}>
      {s.label}
    </span>
  );
}

export function FlashMessage({ flash }: { flash: Flash | null }) {
  if (!flash) return null;
  return flash.tone === "ok" ? (
    <p className="callout mb-4 text-sm" role="status">{flash.text}</p>
  ) : (
    <p className="mb-4 rounded-lg bg-[var(--danger-bg)] p-3 text-sm text-[var(--danger)]" role="alert">{flash.text}</p>
  );
}

/** A small action form: hidden fields plus a button. */
export function ActionButton({
  action,
  fields,
  children,
  className = "btn-secondary",
}: {
  action: (formData: FormData) => Promise<void>;
  fields: Record<string, string>;
  children: ReactNode;
  className?: string;
}) {
  return (
    <form action={action} className="inline">
      {Object.entries(fields).map(([k, v]) => (
        <input key={k} type="hidden" name={k} value={v} />
      ))}
      <button className={className}>{children}</button>
    </form>
  );
}

/** "Remove from this app" behind a confirm box, saying where the record stays. */
export function RemoveForm({
  action,
  fields,
  label,
  stays,
}: {
  action: (formData: FormData) => Promise<void>;
  fields: Record<string, string>;
  label: string;
  stays: string;
}) {
  return (
    <details className="text-sm">
      <summary className="cursor-pointer text-[var(--muted)]">{label}</summary>
      <form action={action} className="mt-2 space-y-2 rounded-lg border border-[var(--border)] p-3">
        {Object.entries(fields).map(([k, v]) => (
          <input key={k} type="hidden" name={k} value={v} />
        ))}
        <p>{stays}</p>
        <label className="flex items-center gap-2">
          <input type="checkbox" name="confirm" value="yes" required /> Remove it from this app only
        </label>
        <button className="btn-secondary">Remove from this app</button>
      </form>
    </details>
  );
}
