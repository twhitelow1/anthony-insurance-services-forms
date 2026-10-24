"use client";

import { useEffect, useState, type ReactNode } from "react";

/**
 * Gmail-style "All 50 on this page are selected. Select all 3,665 matching". Shown once the
 * header SelectAll for `form` is ticked. Choosing it either reveals `children` (a separate form
 * that acts on every match), or, without children, adds `allMatching=yes` to `form` so its own bulk
 * buttons act on every match across all pages (after a confirmation tick). Unticking any row on
 * the page goes back to just the ticked rows.
 */
export function SelectAllMatching({
  form,
  onPage,
  total,
  noun = "Accounts",
  children,
}: {
  form: string;
  onPage: number;
  total: number;
  /** Plural, e.g. "people". */
  noun?: string;
  children?: ReactNode;
}) {
  const [pageSelected, setPageSelected] = useState(false);
  const [all, setAll] = useState(false);

  useEffect(() => {
    const onSelectAll = (e: Event) => {
      const { form: f, checked } = (e as CustomEvent<{ form: string; checked: boolean }>).detail;
      if (f !== form) return;
      setPageSelected(checked);
      if (!checked) setAll(false);
    };
    const onChange = (e: Event) => {
      const box = e.target as HTMLInputElement;
      if (box.name === "ids" && box.getAttribute("form") === form && !box.checked) {
        setPageSelected(false);
        setAll(false);
      }
    };
    document.addEventListener("selectall", onSelectAll);
    document.addEventListener("change", onChange);
    return () => {
      document.removeEventListener("selectall", onSelectAll);
      document.removeEventListener("change", onChange);
    };
  }, [form]);

  if (!pageSelected || total <= onPage) return null;
  const fmt = (n: number) => n.toLocaleString("en-US");
  return (
    <div className="mb-3 rounded-lg border border-[var(--notice-border)] bg-[var(--notice-bg)] p-3 text-sm" role="status">
      {all ? (
        <>
          <p>
            <strong>
              All {fmt(total)} matching {noun} are selected
            </strong>{" "}
            (every page{children ? "" : "; the buttons above now act on all of them"}).{" "}
            <button type="button" className="btn-link" onClick={() => setAll(false)}>
              Select only this page
            </button>
          </p>
          {children ? (
            <div className="mt-2">{children}</div>
          ) : (
            <>
              <input type="hidden" name="allMatching" value="yes" form={form} />
              <label className="mt-2 flex items-center gap-2">
                <input type="checkbox" name="confirmAll" value="yes" form={form} required /> Yes, run it on all {fmt(total)} {noun}. It runs in batches
                while this page is open, and can be stopped.
              </label>
            </>
          )}
        </>
      ) : (
        <p>
          All {fmt(onPage)} on this page are selected.{" "}
          <button type="button" className="btn-link font-semibold" onClick={() => setAll(true)}>
            Select all {fmt(total)} matching
          </button>
        </p>
      )}
    </div>
  );
}
