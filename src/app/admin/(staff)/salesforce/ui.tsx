import type { ReactNode } from "react";
import type { AppState } from "@/lib/salesforce/manager";
import type { Flash } from "@/lib/flash";

const STATE: Record<AppState, { label: string; tone: string; title: string }> = {
  not_in_app: { label: "Not in AIS Connect", tone: "badge-neutral", title: "Only in Salesforce. Sync to bring it in." },
  synced: { label: "Synced", tone: "badge-success", title: "In AIS Connect and kept in sync with Salesforce." },
  unsynced: { label: "Unsynced", tone: "badge-warning", title: "In AIS Connect, but not syncing either way." },
  removed: { label: "Removed here", tone: "badge-neutral", title: "Removed from AIS Connect; still in Salesforce. Sync to bring it back." },
  deactivated: { label: "Deactivated here", tone: "badge-neutral", title: "Deactivated in AIS Connect (kept with its history); still in Salesforce. Reactivate to use it again." },
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
          <input type="checkbox" name="confirm" value="yes" required /> Remove it from AIS Connect only
        </label>
        <button className="btn-secondary">Remove from AIS Connect</button>
      </form>
    </details>
  );
}

/**
 * Deactivate / reactivate an Account in this app, and point it at a different Salesforce Account.
 * Never deletes anything; every step is in the account's activity.
 */
export function AccountLifecycle({
  client,
  back,
  actions,
}: {
  client: { id: string; name: string; sfAccountId: string | null; sfSyncPaused: boolean; deactivatedAt: Date | null; deactivatedBy: string | null };
  back: string;
  actions: {
    deactivate: (formData: FormData) => Promise<void>;
    reactivate: (formData: FormData) => Promise<void>;
    relink: (formData: FormData) => Promise<void>;
  };
}) {
  if (client.deactivatedAt) {
    return (
      <div className="rounded-lg border border-[var(--notice-border)] bg-[var(--notice-bg)] p-3 text-sm" role="status">
        <p>
          <strong>Deactivated in AIS Connect</strong> on {client.deactivatedAt.toLocaleDateString("en-US")}
          {client.deactivatedBy ? ` by ${client.deactivatedBy.replace(/^staff:/, "")}` : ""}. It&apos;s hidden from lists and syncs; everything is
          kept{client.sfAccountId ? `, including its link to Salesforce Account ${client.sfAccountId}` : ""}.
        </p>
        <form action={actions.reactivate} className="mt-2">
          <input type="hidden" name="clientId" value={client.id} />
          <input type="hidden" name="back" value={back} />
          <button className="btn-primary">Reactivate</button>
        </form>
      </div>
    );
  }
  const canDeactivate = !client.sfAccountId || client.sfSyncPaused;
  return (
    <div className="space-y-2 text-sm">
      <details>
        <summary className="cursor-pointer text-[var(--muted)]">Deactivate this Account in AIS Connect</summary>
        {canDeactivate ? (
          <form action={actions.deactivate} className="mt-2 space-y-2 rounded-lg border border-[var(--border)] p-3">
            <input type="hidden" name="clientId" value={client.id} />
            <input type="hidden" name="back" value={back} />
            <p>
              Hides &quot;{client.name}&quot; in AIS Connect. Nothing is deleted here or in Salesforce; its contacts, applications, Salesforce link and
              activity are kept, and you can reactivate it at any time.
            </p>
            <label className="block">
              <span className="field-label">Reason (optional, saved in the activity)</span>
              <input name="reason" className="input" maxLength={300} />
            </label>
            <label className="flex items-center gap-2">
              <input type="checkbox" name="confirm" value="yes" required /> Deactivate it in AIS Connect
            </label>
            <button className="btn-secondary">Deactivate</button>
          </form>
        ) : (
          <p className="mt-2 text-[var(--muted)]">Unsync it first (it&apos;s still syncing with Salesforce), then deactivate it.</p>
        )}
      </details>
      <details>
        <summary className="cursor-pointer text-[var(--muted)]">{client.sfAccountId ? "Link to a different Salesforce Account" : "Link to a Salesforce Account"}</summary>
        <form action={actions.relink} className="mt-2 space-y-2 rounded-lg border border-[var(--border)] p-3">
          <input type="hidden" name="clientId" value={client.id} />
          <input type="hidden" name="back" value={back} />
          <label className="block">
            <span className="field-label">Salesforce Account ID or address</span>
            <input name="sfAccount" className="input" placeholder="001… or https://….lightning.force.com/lightning/r/Account/001…/view" required maxLength={300} />
          </label>
          <p className="text-xs text-[var(--muted)]">The previous link stays in the activity log. Nothing changes in Salesforce.</p>
          <button className="btn-secondary">Link</button>
        </form>
      </details>
    </div>
  );
}
