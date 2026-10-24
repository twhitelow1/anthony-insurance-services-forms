import { readFileSync } from "node:fs";
import { join } from "node:path";
import { describe, expect, it } from "vitest";

// "Create missing contacts in Lead Alchemist" starts ticked on every screen that syncs to Lead
// Alchemist (decision 2026-10-24); unticking it stays possible for link-only runs.
const SCREENS = ["mapping/page.tsx", "clients/AcrossView.tsx", "clients/[id]/page.tsx", "contacts/page.tsx"];

describe('"Create missing contacts" default', () => {
  it.each(SCREENS)("is ticked on %s, with the workflow note", (file) => {
    const src = readFileSync(join(__dirname, file), "utf8");
    const boxes = src.match(/<input type="checkbox" name="createMissing"[^>]*>/g) ?? [];
    expect(boxes.length).toBeGreaterThan(0);
    for (const box of boxes) expect(box).toMatch(/defaultChecked(?![=])/);
    expect(src).toMatch(/can start (its|Lead Alchemist) workflows/);
  });
});
