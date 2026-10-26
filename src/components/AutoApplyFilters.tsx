"use client";

import { useEffect } from "react";

/**
 * Changing a dropdown in a search or filter form (role="search" or method="get") applies it at once,
 * with no need to press Search or Filter. Typed search text still waits for Enter or the button.
 * Bulk-action forms are left alone; a select can opt out with data-no-auto.
 */
export function AutoApplyFilters() {
  useEffect(() => {
    const onChange = (e: Event) => {
      const el = e.target;
      if (!(el instanceof HTMLSelectElement) || el.dataset.noAuto !== undefined) return;
      const form = el.form;
      if (!form) return;
      if (form.getAttribute("role") === "search" || form.getAttribute("method")?.toLowerCase() === "get") form.requestSubmit();
    };
    document.addEventListener("change", onChange);
    return () => document.removeEventListener("change", onChange);
  }, []);
  return null;
}
