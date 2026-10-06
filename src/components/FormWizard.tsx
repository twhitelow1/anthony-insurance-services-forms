"use client";

import { useEffect, useRef, useState } from "react";
import { getForm } from "@/forms";
import { type FieldErrors, isVisible, pruneValues, validateSection } from "@/lib/forms/validate";
import { type FormValues, type Option, isInputField } from "@/lib/forms/types";
import { Content, FieldInput, TableInput } from "./Fields";

type Status =
  | { kind: "idle" }
  | { kind: "submitting" }
  | { kind: "done"; reference: string; pdfUrl?: string }
  | { kind: "error"; message: string };

/** Staff editing a submitted application: start from its answers, save with PUT, then go back. */
export interface EditMode {
  initial: FormValues;
  saveUrl: string;
  doneHref: string;
}

const draftKey = (slug: string) => `ais-form-draft:${slug}`;

/** Tell a parent page (when embedded in an iframe) about our height and events. */
function postToParent(msg: Record<string, unknown>) {
  if (typeof window !== "undefined" && window.parent !== window) {
    window.parent.postMessage({ source: "ais-forms", ...msg }, "*");
  }
}

export function FormWizard({ slug, edit }: { slug: string; edit?: EditMode }) {
  const form = getForm(slug)!;
  const [values, setValuesState] = useState<FormValues>(edit?.initial ?? {});
  const [step, setStep] = useState(0);
  const [errors, setErrors] = useState<FieldErrors>({});
  const [status, setStatus] = useState<Status>({ kind: "idle" });
  const [hp, setHp] = useState("");
  const [restored, setRestored] = useState(false);
  const topRef = useRef<HTMLDivElement>(null);
  const rootRef = useRef<HTMLDivElement>(null);

  // Restore a saved draft (everything except the signature). This has to run after
  // hydration — localStorage doesn't exist during server rendering.
  /* eslint-disable react-hooks/set-state-in-effect */
  useEffect(() => {
    if (edit) return;
    try {
      const raw = localStorage.getItem(draftKey(slug));
      if (raw) {
        const draft = JSON.parse(raw) as { values: FormValues; step: number };
        setValuesState(draft.values ?? {});
        setStep(Math.min(draft.step ?? 0, form.sections.length - 1));
        setRestored(true);
      }
    } catch {
      /* storage unavailable */
    }
  }, [slug, form.sections.length, edit]);
  /* eslint-enable react-hooks/set-state-in-effect */

  useEffect(() => {
    if (status.kind === "done" || edit) return;
    const t = setTimeout(() => {
      try {
        const { signature: _omit, ...rest } = values;
        void _omit;
        localStorage.setItem(draftKey(slug), JSON.stringify({ values: rest, step }));
      } catch {
        /* storage unavailable */
      }
    }, 400);
    return () => clearTimeout(t);
  }, [values, step, slug, status.kind, edit]);

  // Auto-resize when embedded.
  useEffect(() => {
    const el = rootRef.current;
    if (!el) return;
    const ro = new ResizeObserver(() => postToParent({ type: "height", height: document.documentElement.scrollHeight }));
    ro.observe(el);
    return () => ro.disconnect();
  }, []);

  const section = form.sections[step];
  const isLast = step === form.sections.length - 1;

  const setValues = (patch: FormValues) => {
    setValuesState((prev) => ({ ...prev, ...patch }));
    setErrors((prev) => {
      const next = { ...prev };
      for (const k of Object.keys(patch)) delete next[k];
      return next;
    });
  };

  const effectiveOptions = (base: Option[], filter?: (o: Option[], v: FormValues) => Option[]) =>
    filter ? filter(base, values) : base;

  const scrollTop = () => {
    topRef.current?.scrollIntoView({ behavior: "smooth", block: "start" });
    postToParent({ type: "scrollTop" });
  };

  const focusFirstError = (errs: FieldErrors) => {
    const first = Object.keys(errs)[0];
    requestAnimationFrame(() => {
      const el = document.getElementById(first) ?? document.querySelector<HTMLElement>(`[name="${first}"]`);
      el?.scrollIntoView({ behavior: "smooth", block: "center" });
      el?.focus({ preventScroll: true });
    });
  };

  const validateCurrent = () => validateSection(section, values);

  const next = () => {
    const errs = validateCurrent();
    setErrors(errs);
    if (Object.keys(errs).length) return focusFirstError(errs);
    setStep((s) => s + 1);
    scrollTop();
  };

  const back = () => {
    setErrors({});
    setStep((s) => Math.max(s - 1, 0));
    scrollTop();
  };

  const submit = async () => {
    const errs = validateCurrent();
    setErrors(errs);
    if (Object.keys(errs).length) return focusFirstError(errs);

    setStatus({ kind: "submitting" });
    try {
      const res = await fetch(edit?.saveUrl ?? `/api/forms/${slug}/submit`, {
        method: edit ? "PUT" : "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ values: pruneValues(form, values), website_hp: hp }),
      });
      const data = await res.json().catch(() => ({}));
      if (res.ok && edit) {
        window.location.assign(edit.doneHref);
        return;
      }
      if (res.ok) {
        setStatus({
          kind: "done",
          reference: String(data.reference ?? ""),
          pdfUrl: typeof data.pdfUrl === "string" && data.pdfUrl.startsWith("/receipt/") ? data.pdfUrl : undefined,
        });
        try {
          localStorage.removeItem(draftKey(slug));
        } catch {}
        postToParent({ type: "submitted", form: slug });
        scrollTop();
        return;
      }
      if (res.status === 422 && data.errors) {
        // Jump to the first section with a server-side error.
        const errs = data.errors as FieldErrors;
        const idx = form.sections.findIndex((s) => s.fields.some((f) => isInputField(f) && errs[f.id]));
        if (idx >= 0) setStep(idx);
        setErrors(errs);
        setStatus({ kind: "error", message: "Please fix the highlighted fields." });
        focusFirstError(errs);
        return;
      }
      setStatus({ kind: "error", message: data.error ?? "Something went wrong. Please try again." });
    } catch {
      setStatus({ kind: "error", message: "Network error. Check your connection and try again." });
    }
  };

  const progress = Math.round(((step + 1) / form.sections.length) * 100);

  if (status.kind === "done") {
    return (
      <div ref={rootRef} className="card text-center" role="status">
        <div ref={topRef} />
        <div className="mx-auto mb-4 flex h-14 w-14 items-center justify-center rounded-full bg-[var(--success-bg)] text-[var(--success)]">
          <svg viewBox="0 0 24 24" className="h-7 w-7" fill="none" stroke="currentColor" strokeWidth="2.5" aria-hidden="true">
            <path d="M5 12.5l4.5 4.5L19 7.5" strokeLinecap="round" strokeLinejoin="round" />
          </svg>
        </div>
        <h2 className="mb-2 text-2xl font-semibold">Application submitted</h2>
        <p className="mx-auto max-w-md text-[var(--muted)]">{form.successMessage}</p>
        {status.reference && (
          <p className="mx-auto mt-5 inline-block rounded-lg bg-[var(--accent-soft)] px-4 py-2">
            Reference number: <span className="font-mono font-semibold">{status.reference}</span>
          </p>
        )}
        {status.pdfUrl && (
          <div className="mt-5">
            <a className="btn-secondary" href={status.pdfUrl} target="_blank" rel="noopener">
              View a copy of your application (PDF)
            </a>
            <p className="mt-2 text-xs text-[var(--muted)]">This link works for one hour. After that, sign in to check your status.</p>
          </div>
        )}
        <p className="mt-5 text-sm text-[var(--muted)]">
          We&apos;ve emailed you a confirmation. You can{" "}
          <a className="btn-link" href="/portal/login" target="_top">
            check your application status
          </a>{" "}
          any time.
        </p>
      </div>
    );
  }

  return (
    <div ref={rootRef}>
      <div ref={topRef} className="scroll-mt-4" />

      {/* Progress */}
      <div className="mb-6">
        <div className="mb-2 flex items-baseline justify-between gap-4 text-sm">
          <span className="font-medium text-[var(--brand)]">
            Step {step + 1} of {form.sections.length}
          </span>
          <span className="text-[var(--muted)]">{progress}% complete</span>
        </div>
        <div
          className="h-2 overflow-hidden rounded-full bg-[var(--track)]"
          role="progressbar"
          aria-valuenow={progress}
          aria-valuemin={0}
          aria-valuemax={100}
          aria-label="Application progress"
        >
          <div className="h-full rounded-full bg-[var(--accent)] transition-[width] duration-500" style={{ width: `${progress}%` }} />
        </div>
        <ol className="step-pills mt-3" aria-label="Sections">
          {form.sections.map((s, i) => (
            <li key={s.id}>
              <button
                type="button"
                className={`step-pill ${i === step ? "is-current" : i < step ? "is-done" : ""}`}
                aria-current={i === step ? "step" : undefined}
                disabled={!edit && i > step}
                onClick={() => {
                  if (edit || i < step) {
                    setErrors({});
                    setStep(i);
                    scrollTop();
                  }
                }}
              >
                <span className="step-num">{i + 1}</span>
                <span className="step-title">{s.title}</span>
              </button>
            </li>
          ))}
        </ol>
      </div>

      {restored && step > 0 && (
        <div className="callout mb-4 flex flex-wrap items-center justify-between gap-2 text-sm">
          <span>We restored your saved progress.</span>
          <button
            type="button"
            className="btn-link"
            onClick={() => {
              setValuesState({});
              setStep(0);
              setRestored(false);
              try {
                localStorage.removeItem(draftKey(slug));
              } catch {}
            }}
          >
            Start over
          </button>
        </div>
      )}

      <form
        className="card"
        noValidate
        onSubmit={(e) => {
          e.preventDefault();
          if (isLast) submit();
          else next();
        }}
      >
        <header className="mb-6">
          <p className="text-sm font-semibold uppercase tracking-wider text-[var(--accent-strong)]">Section {step + 1}</p>
          <h2 className="text-2xl font-semibold">{section.title}</h2>
          {section.description && <p className="mt-2 text-[var(--muted)]">{section.description}</p>}
        </header>

        {/* Honeypot — hidden from humans and assistive tech */}
        <div aria-hidden="true" className="absolute -left-[9999px] h-px w-px overflow-hidden">
          <label>
            Leave this empty
            <input tabIndex={-1} autoComplete="off" value={hp} onChange={(e) => setHp(e.target.value)} />
          </label>
        </div>

        <div className="grid grid-cols-6 gap-x-4 gap-y-5">
          {section.fields.filter((f) => isVisible(f, values)).map((f) => {
            if (f.type === "content") return <Content key={f.id} block={f} />;
            if (f.type === "table") return <TableInput key={f.id} table={f} values={values} setValues={setValues} />;
            return (
              <FieldInput
                key={f.id}
                field={f}
                value={values[f.id]}
                error={errors[f.id]}
                options={"options" in f ? effectiveOptions(f.options, f.filterOptions) : undefined}
                onChange={(v) => setValues({ [f.id]: v })}
              />
            );
          })}
        </div>

        {Object.keys(errors).length > 0 && (
          <p className="mt-6 text-sm font-medium text-[var(--danger)]" role="alert">
            Please complete the {Object.keys(errors).length === 1 ? "highlighted field" : `${Object.keys(errors).length} highlighted fields`} to continue.
          </p>
        )}
        {status.kind === "error" && (
          <p className="mt-4 rounded-lg bg-[var(--danger-bg)] p-3 text-sm text-[var(--danger)]" role="alert">
            {status.message}
          </p>
        )}

        <div className="mt-8 flex flex-col-reverse gap-3 border-t border-[var(--border)] pt-6 sm:flex-row sm:justify-between">
          <button type="button" className="btn-secondary" onClick={back} disabled={step === 0} style={{ visibility: step === 0 ? "hidden" : undefined }}>
            Back
          </button>
          <button type="submit" className="btn-primary" disabled={status.kind === "submitting"}>
            {isLast
              ? status.kind === "submitting"
                ? edit
                  ? "Saving…"
                  : "Submitting…"
                : edit
                  ? "Save changes"
                  : "Submit application"
              : "Continue"}
          </button>
        </div>
        <p className="mt-4 text-center text-xs text-[var(--muted)]">
          {edit
            ? "Changes are saved when you press Save changes on the last step. The PDFs are rebuilt afterwards."
            : "Your progress is saved on this device automatically."}
        </p>
      </form>
    </div>
  );
}
