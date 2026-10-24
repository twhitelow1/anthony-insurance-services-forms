"use client";

import { useEffect, useState, type ReactNode } from "react";

/**
 * Gmail-style "All 50 on this page are selected. Select all 3,665 matching". Shown once the
 * header SelectAll for `form` is ticked; choosing it reveals `children` (the form that acts on
 * every match, across all pages). Unticking any row on the page hides it again.
 */
export function SelectAllMatching({ form, onPage, total, children }: { form: string; onPage: number; total: number; children: ReactNode }) {
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
            <strong>All {fmt(total)} matching Accounts are selected</strong> (every page).{" "}
            <button type="button" className="btn-link" onClick={() => setAll(false)}>
              Select only this page
            </button>
          </p>
          <div className="mt-2">{children}</div>
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
