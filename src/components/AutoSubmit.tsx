"use client";

import { useEffect, useRef } from "react";

/**
 * Submits the surrounding form shortly after the page loads, so a long job (a Salesforce
 * scan, applying a mapping) continues batch by batch on its own while staff watch. The
 * button stays visible so it also works by hand.
 */
export function AutoSubmit({ label, delayMs = 800 }: { label: string; delayMs?: number }) {
  const ref = useRef<HTMLButtonElement>(null);
  useEffect(() => {
    const t = setTimeout(() => ref.current?.form?.requestSubmit(), delayMs);
    return () => clearTimeout(t);
  }, [delayMs]);
  return (
    <button ref={ref} className="btn-secondary">
      {label}
    </button>
  );
}
