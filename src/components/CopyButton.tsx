"use client";

import { useState } from "react";

/** Copies `text` to the clipboard and says so. */
export function CopyButton({ text, label = "Copy" }: { text: string; label?: string }) {
  const [copied, setCopied] = useState(false);
  return (
    <button
      type="button"
      className="btn-secondary !min-h-0 px-3 py-1.5 text-sm"
      onClick={async () => {
        try {
          await navigator.clipboard.writeText(text);
          setCopied(true);
          setTimeout(() => setCopied(false), 2000);
        } catch {
          window.prompt("Copy this:", text);
        }
      }}
    >
      <span aria-live="polite">{copied ? "Copied!" : label}</span>
    </button>
  );
}
