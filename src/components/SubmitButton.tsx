"use client";

import { useState, type ReactNode } from "react";
import { useFormStatus } from "react-dom";

/**
 * A submit button that shows it's working: while its form is submitting, every SubmitButton in
 * that form is disabled and the one that was clicked says "Working…", so a long bulk action (a
 * Lead Alchemist or Salesforce sync can take up to a minute) never looks like a dead button.
 */
export function SubmitButton({
  children,
  formAction,
  className = "btn-secondary",
  disabled,
  title,
  pendingLabel = "Working… keep this page open",
}: {
  children: ReactNode;
  formAction?: (formData: FormData) => void | Promise<void>;
  className?: string;
  disabled?: boolean;
  title?: string;
  pendingLabel?: string;
}) {
  const { pending } = useFormStatus();
  const [clicked, setClicked] = useState(false);
  // Forget the click once the submission is over (state adjusted during render, not in an effect).
  const [wasPending, setWasPending] = useState(pending);
  if (pending !== wasPending) {
    setWasPending(pending);
    if (!pending) setClicked(false);
  }
  return (
    <button formAction={formAction} className={className} disabled={disabled || pending} title={title} aria-busy={pending && clicked} onClick={() => setClicked(true)}>
      {pending && clicked ? pendingLabel : children}
    </button>
  );
}
