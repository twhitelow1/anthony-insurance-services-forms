import { describe, expect, it } from "vitest";
import { forms } from "@/forms";
import { BRANDS, EMBED_ORIGINS, brandCss, defaultBrand, isBrand } from "./brands";

describe("embed branding", () => {
  it("puts each form on its website by default", () => {
    expect(defaultBrand(forms["aerial-dance-studio-application"])).toBe("dsi");
    expect(defaultBrand(forms["fitness-facility-application"])).toBe("dsi");
    expect(defaultBrand(forms["boxing-gym-application"])).toBe("masi");
    expect(defaultBrand(forms["martial-arts-event-application"])).toBe("masi");
    expect(defaultBrand(forms["special-event-application"])).toBe("ais");
    expect(defaultBrand(forms["sports-facility-application"])).toBe("ais");
  });

  it("renders CSS variable overrides and only allows the agency's sites to frame forms", () => {
    expect(brandCss(BRANDS.dsi, true)).toMatch(/^:root\{--brand:#660066;.*--bg:transparent\}$/);
    expect(brandCss(BRANDS.dsi, false)).not.toContain("--bg");
    expect(isBrand("masi")).toBe(true);
    expect(isBrand("evil")).toBe(false);
    expect(EMBED_ORIGINS).toContain("https://dancestudioinsurance.com");
    expect(EMBED_ORIGINS).toContain("https://*.martialartsschoolinsurance.com");
    expect(EMBED_ORIGINS.every((o) => o.startsWith("https://"))).toBe(true);
  });
});
