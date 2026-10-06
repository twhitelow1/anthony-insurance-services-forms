import { describe, expect, it } from "vitest";
import { forms } from "@/forms";
import { createApplication } from "@/lib/applications/repo";
import { buildApplicationPdf } from "@/lib/pdf/summary";
import { isInputField, tableCellId, tableRowCountId, type Field, type FormDefinition, type FormValues } from "@/lib/forms/types";
import { isVisible, pruneValues, validateForm } from "@/lib/forms/validate";

const SIGNATURE =
  "data:image/png;base64,iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAYAAAAfFcSJAAAADUlEQVR42mNkYPhfDwAChwGA60e6kgAAAAABJRU5ErkJggg==";

const allFields = (form: FormDefinition): Field[] => form.sections.flatMap((s) => s.fields);

/** A plausible answer for one field: "No" for yes/no (so follow-ups stay hidden), the first option otherwise. */
function answer(field: Field): Partial<FormValues> {
  if (field.type === "table") {
    return {
      [tableRowCountId(field.id)]: "1",
      ...Object.fromEntries(field.columns.map((c) => [tableCellId(field.id, 1, c.id), c.type === "number" ? "1" : "Test"])),
    };
  }
  if (!isInputField(field)) return {};
  switch (field.type) {
    case "radio":
    case "select": {
      const no = field.options.find((o) => o.value === "No");
      return { [field.id]: (no ?? field.options[0]).value };
    }
    case "checkboxes":
      return { [field.id]: [field.options[0].value] };
    case "email":
      return { [field.id]: "applicant@example.com" };
    case "tel":
      return { [field.id]: "(555) 010-0100" };
    case "url":
      return { [field.id]: "example.com" };
    case "date":
      return { [field.id]: "2026-12-01" };
    case "number":
      return { [field.id]: String(Math.max(field.min ?? 0, 1)) };
    case "currency":
      return { [field.id]: "1000" };
    case "signature":
      return { [field.id]: SIGNATURE };
    default:
      return { [field.id]: "Test" };
  }
}

/** Answer every visible question, repeating until answers stop revealing new questions. */
function fillAll(form: FormDefinition): FormValues {
  let values: FormValues = {};
  for (let pass = 0; pass < 6; pass++) {
    const before = Object.keys(values).length;
    for (const f of allFields(form)) {
      if (!isVisible(f, values)) continue;
      const a = answer(f);
      for (const [k, v] of Object.entries(a)) if (values[k] === undefined) values = { ...values, [k]: v };
    }
    if (Object.keys(values).length === before) break;
  }
  return pruneValues(form, values);
}

describe.each(Object.values(forms).map((f) => [f.slug, f] as const))("form %s", (slug, form) => {
  it("is registered under its own slug, tagged, and has unique field ids", () => {
    expect(forms[slug]).toBe(form);
    expect(form.tags).toContain(`form:${slug}`);
    const ids = allFields(form).map((f) => f.id);
    expect(ids.filter((id, i) => ids.indexOf(id) !== i)).toEqual([]);
  });

  it("asks for the contact details the app and GHL rely on", () => {
    const byId = new Map(allFields(form).map((f) => [f.id, f]));
    for (const [id, ghl] of [
      ["first_name", "firstName"],
      ["last_name", "lastName"],
      ["email", "email"],
      ["phone", "phone"],
    ] as const) {
      const f = byId.get(id);
      expect(f, `${slug} needs a ${id} field`).toBeDefined();
      expect(f && "ghl" in f ? f.ghl?.standard : undefined, `${slug}.${id} → GHL ${ghl}`).toBe(ghl);
    }
    const sig = byId.get("signature");
    expect(sig?.type, `${slug} needs a required signature`).toBe("signature");
  });

  it("validates a fully answered application, saves it and builds its PDF", async () => {
    const values = fillAll(form);
    expect(validateForm(form, values)).toEqual({});
    expect(Object.keys(validateForm(form, {})).length).toBeGreaterThan(0);

    const app = await createApplication(form, values, {});
    expect(app.applicantEmail).toBe("applicant@example.com");
    const pdf = await buildApplicationPdf(form, app);
    expect(Buffer.from(pdf).subarray(0, 5).toString()).toBe("%PDF-");
  });
});
