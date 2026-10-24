"use client";

/** A header checkbox that ticks every row checkbox belonging to the given form. */
export function SelectAll({ form, label = "Select all on this page (tip: shift-click a row to tick a range)" }: { form: string; label?: string }) {
  return (
    <input
      type="checkbox"
      aria-label={label}
      title={label}
      onChange={(e) => {
        document.querySelectorAll<HTMLInputElement>(`input[type="checkbox"][name="ids"][form="${form}"]`).forEach((box) => {
          box.checked = e.currentTarget.checked;
        });
        // Lets a "Select all N matching" banner (SelectAllMatching) know the page was selected.
        document.dispatchEvent(new CustomEvent("selectall", { detail: { form, checked: e.currentTarget.checked } }));
      }}
    />
  );
}
