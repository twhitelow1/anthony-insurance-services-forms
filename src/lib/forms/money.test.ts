import { describe, expect, it } from "vitest";
import { formatCurrency, plainAmount } from "./helpers";
import { answerSections } from "./flatten";
import { larpEventApplication } from "@/forms/larp-event-application";
import { sportsFacilityApplication } from "@/forms/sports-facility-application";
import { pruneValues } from "./validate";

describe("currency formatting", () => {
  it.each([
    ["1500", "$1,500"],
    ["1,500", "$1,500"],
    ["$1,500", "$1,500"],
    ["$ 2500000", "$2,500,000"],
    ["1500.5", "$1,500.50"],
    ["0", "$0"],
    ["N/A", "N/A"],
    ["", ""],
  ])("%s → %s (one $, never two or none)", (raw, shown) => {
    expect(formatCurrency(raw)).toBe(shown);
  });

  it("gives the bare amount for PDF boxes that print their own $", () => {
    expect(plainAmount("$12,000")).toBe("12,000");
    expect(plainAmount("12000")).toBe("12,000");
  });

  it("shows currency answers with a $ in the admin and portal views", () => {
    const rows = answerSections(sportsFacilityApplication, { retail_sales: "Yes", retail_receipts: "25,000" }).flatMap((s) => s.rows);
    expect(rows.find((r) => r.label === "Total Retail Receipts")?.value).toBe("$25,000");
  });
});

describe("LARP total participants", () => {
  it("is the youth plus adult counts, whatever the browser sent", () => {
    const v = pruneValues(larpEventApplication, { youth_participants: "40", adult_participants: "25", total_participants: "999" });
    expect(v.total_participants).toBe("65");
    expect(pruneValues(larpEventApplication, { youth_participants: "12" }).total_participants).toBe("12");
    expect(pruneValues(larpEventApplication, {}).total_participants).toBeUndefined();
  });

  it("no longer asks for payment", () => {
    const ids = larpEventApplication.sections.flatMap((s) => s.fields.map((f) => f.id));
    expect(ids).not.toContain("payment_enclosed");
    expect(ids).not.toContain("payment_method");
    expect(ids).toContain("quote_note");
  });
});
