"use client";

import { useEffect } from "react";

/**
 * Shift-click a row's tick box to tick (or untick) every row between it and the last one clicked,
 * like Gmail. Works on every list whose row boxes are `name="ids"`, within the same form. Mounted
 * once in the staff layout; renders nothing.
 */
export function ShiftClickRange() {
  useEffect(() => {
    let last: HTMLInputElement | null = null;
    const onClick = (e: MouseEvent) => {
      const box = e.target;
      if (!(box instanceof HTMLInputElement) || box.type !== "checkbox" || box.name !== "ids") return;
      const form = box.getAttribute("form") ?? box.form?.id ?? "";
      if (e.shiftKey && last && last !== box && last.isConnected && (last.getAttribute("form") ?? last.form?.id ?? "") === form) {
        const boxes = Array.from(document.querySelectorAll<HTMLInputElement>('input[type="checkbox"][name="ids"]')).filter(
          (b) => (b.getAttribute("form") ?? b.form?.id ?? "") === form,
        );
        const [a, b] = [boxes.indexOf(last), boxes.indexOf(box)].sort((x, y) => x - y);
        if (a >= 0) {
          for (const other of boxes.slice(a, b + 1)) {
            if (other === box || other.disabled || other.checked === box.checked) continue;
            other.checked = box.checked;
            // Lets anything watching the boxes (e.g. "Select all matching") see the change.
            other.dispatchEvent(new Event("change", { bubbles: true }));
          }
        }
      }
      last = box;
    };
    document.addEventListener("click", onClick);
    return () => document.removeEventListener("click", onClick);
  }, []);
  return null;
}
