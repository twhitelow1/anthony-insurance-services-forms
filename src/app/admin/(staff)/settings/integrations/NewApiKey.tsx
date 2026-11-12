"use client";

import { useActionState } from "react";
import { CopyButton } from "@/components/CopyButton";
import { createApiKeyAction, type NewKeyState } from "./api-actions";

/** Make a key; it's shown here once, to copy into Lead Alchemist. */
export function NewApiKey() {
  const [state, action, pending] = useActionState<NewKeyState, FormData>(createApiKeyAction, {});
  return (
    <div className="space-y-3">
      <form action={action} className="flex flex-wrap items-end gap-2">
        <div className="min-w-0 flex-1">
          <label className="field-label" htmlFor="api-key-name">New key name</label>
          <input id="api-key-name" name="name" className="input" placeholder="e.g. Lead Alchemist Ask AI" maxLength={80} />
        </div>
        <button className="btn-primary" disabled={pending}>{pending ? "Making…" : "Make a key"}</button>
      </form>
      {state.error && <p className="text-sm text-[var(--danger)]" role="alert">{state.error}</p>}
      {state.key && (
        <div className="callout space-y-2 text-sm" role="status">
          <p>
            <strong>{state.name}</strong>: copy this key now. It won&apos;t be shown again (only a fingerprint is kept).
          </p>
          <code className="block break-all rounded bg-[var(--track)] p-2 text-xs">{state.key}</code>
          <CopyButton text={state.key} label="Copy key" />
        </div>
      )}
    </div>
  );
}
