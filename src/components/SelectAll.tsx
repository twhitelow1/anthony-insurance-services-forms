"use client";

/** A header checkbox that ticks every row checkbox belonging to the given form. */
export function SelectAll({ form, label = "Select all on this page" }: { form: string; label?: string }) {
  return (
    <input
      type="checkbox"
      aria-label={label}
      title={label}
      onChange={(e) => {
        document.querySelectorAll<HTMLInputElement>(`input[type="checkbox"][name="ids"][form="${form}"]`).forEach((box) => {
          box.checked = e.currentTarget.checked;
        });
      }}
    />
  );
}
