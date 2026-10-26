"use client";

import { useState, type ReactNode } from "react";

/**
 * A message staff can close (✕). Closing also drops the message's ?f= from the address, so it
 * doesn't come back on refresh.
 */
export function Dismissible({ children, className, role }: { children: ReactNode; className: string; role: "status" | "alert" }) {
  const [open, setOpen] = useState(true);
  if (!open) return null;
  return (
    <div className={`${className} flex items-start gap-3`} role={role}>
      <div className="flex-1">{children}</div>
      <button
        type="button"
        className="-m-1 rounded px-2 py-0.5 text-base leading-none text-[var(--muted)] hover:bg-black/5"
        aria-label="Close this message"
        title="Close"
        onClick={() => {
          setOpen(false);
          const url = new URL(window.location.href);
          if (url.searchParams.has("f")) {
            url.searchParams.delete("f");
            window.history.replaceState(window.history.state, "", url);
          }
        }}
      >
        ✕
      </button>
    </div>
  );
}
