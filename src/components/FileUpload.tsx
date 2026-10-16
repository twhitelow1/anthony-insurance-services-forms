"use client";

import { useRef, useState } from "react";
import { parseUploadRef } from "@/lib/forms/types";

const ACCEPT = ".pdf,.doc,.docx,.jpg,.jpeg,.png";

/**
 * Attach files (e.g. waivers). Each file uploads as soon as it's picked; the value is the
 * list of upload references the server returned, so nothing large travels with the answers.
 */
export function FileUpload({
  id,
  formSlug,
  value,
  maxFiles,
  invalid,
  describedBy,
  onChange,
}: {
  id: string;
  formSlug: string;
  value: string[];
  maxFiles: number;
  invalid?: boolean;
  describedBy?: string;
  onChange: (refs: string[]) => void;
}) {
  const inputRef = useRef<HTMLInputElement>(null);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const upload = async (files: FileList | null) => {
    if (!files?.length) return;
    setError(null);
    const room = maxFiles - value.length;
    const picked = Array.from(files).slice(0, Math.max(room, 0));
    if (files.length > room) setError(`You can attach up to ${maxFiles} files.`);
    setBusy(true);
    const added: string[] = [];
    for (const file of picked) {
      const body = new FormData();
      body.append("file", file);
      body.append("field", id);
      try {
        const res = await fetch(`/api/forms/${formSlug}/upload`, { method: "POST", body });
        const data = await res.json().catch(() => ({}));
        if (res.ok && typeof data.ref === "string") added.push(data.ref);
        else setError(`${file.name}: ${data.error ?? "couldn't upload. Try again."}`);
      } catch {
        setError(`${file.name}: network error. Try again.`);
      }
    }
    setBusy(false);
    if (added.length) onChange([...value, ...added]);
    if (inputRef.current) inputRef.current.value = "";
  };

  return (
    <div>
      {value.length > 0 && (
        <ul className="mb-2 space-y-1">
          {value.map((ref) => (
            <li key={ref} className="flex items-center justify-between gap-3 rounded-lg border border-[var(--border)] px-3 py-2 text-sm">
              <span className="min-w-0 truncate">📎 {parseUploadRef(ref)?.filename ?? "File"}</span>
              <button type="button" className="btn-link text-[var(--danger)]" onClick={() => onChange(value.filter((r) => r !== ref))}>
                Remove
              </button>
            </li>
          ))}
        </ul>
      )}
      {value.length < maxFiles && (
        <label
          htmlFor={id}
          className={`flex cursor-pointer flex-col items-center justify-center rounded-lg border-2 border-dashed px-4 py-5 text-center text-sm ${invalid ? "border-[var(--danger)]" : "border-[var(--border)]"} hover:border-[var(--accent)]`}
        >
          <span className="font-medium text-[var(--brand)]">{busy ? "Uploading…" : value.length ? "Add another file" : "Choose a file to upload"}</span>
          <span className="mt-1 text-xs text-[var(--muted)]">PDF, Word, JPG or PNG · up to 4 MB each · {maxFiles} files max</span>
          <input
            ref={inputRef}
            id={id}
            name={id}
            type="file"
            accept={ACCEPT}
            multiple
            disabled={busy}
            className="sr-only"
            aria-describedby={describedBy}
            onChange={(e) => upload(e.target.files)}
          />
        </label>
      )}
      {error && (
        <p className="mt-1 text-sm text-[var(--danger)]" role="alert">
          {error}
        </p>
      )}
    </div>
  );
}
