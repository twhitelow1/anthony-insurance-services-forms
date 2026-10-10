import type { FormDefinition } from "@/lib/forms/types";

/**
 * Site branding for embedded forms, so a form on dancestudioinsurance.com looks
 * like DSI and one on martialartsschoolinsurance.com looks like MASI. Colors come
 * from each site's theme CSS (2026-10); text-on-color pairs are darkened where
 * needed to keep WCAG AA contrast. MASI's palette couldn't be read from its
 * Elementor kit, so it uses its dark hero color and a neutral accent — confirm.
 */
export type BrandId = "ais" | "dsi" | "masi";

export interface Brand {
  id: BrandId;
  name: string;
  site: string;
  /** Hot-linked from the brand's own site; null → text wordmark. */
  logo: string | null;
  vars: Record<string, string>;
}

export const BRANDS: Record<BrandId, Brand> = {
  ais: {
    id: "ais",
    name: "Anthony Insurance Services",
    site: "https://anthonyinsuranceservices.com",
    logo: null,
    vars: {
      "--brand": "#303133", // headings / logo color
      "--button": "#c4461b", // site accent #eb5929, darkened for white text
      "--button-hover": "#a33a16",
      "--accent": "#eb5929",
      "--accent-strong": "#b8431c",
      "--accent-soft": "#fdeee8",
      "--tooltip-bg": "#303133",
      "--focus": "0 0 0 3px rgb(235 89 41 / 0.3)",
    },
  },
  dsi: {
    id: "dsi",
    name: "Dance Studio Insurance",
    site: "https://dancestudioinsurance.com",
    logo: "https://dancestudioinsurance.com/wp-content/uploads/2015/12/dsi_03.png",
    vars: {
      "--brand": "#660066", // primary purple
      "--button": "#c4380c", // site button orange #e8420e, darkened for white text
      "--button-hover": "#a32f0a",
      "--accent": "#660066",
      "--accent-strong": "#660066",
      "--accent-soft": "#f6e9f6",
      "--tooltip-bg": "#13134e", // navy
      "--focus": "0 0 0 3px rgb(102 0 102 / 0.25)",
    },
  },
  masi: {
    id: "masi",
    name: "Martial Arts School Insurance",
    site: "https://martialartsschoolinsurance.com",
    logo: "https://martialartsschoolinsurance.com/wp-content/uploads/2025/08/02-png-scaled-e1754481465567-1024x396.png",
    vars: {
      "--brand": "#262e37", // site's dark section color
      "--button": "#262e37",
      "--button-hover": "#141a20",
      "--accent": "#b3261e",
      "--accent-strong": "#9c2019",
      "--accent-soft": "#fbeceb",
      "--tooltip-bg": "#262e37",
      "--focus": "0 0 0 3px rgb(179 38 30 / 0.25)",
    },
  },
};

export const isBrand = (v: unknown): v is BrandId => typeof v === "string" && v in BRANDS;

/** Which site a form belongs on by default. */
export function defaultBrand(form: Pick<FormDefinition, "tags">): BrandId {
  if (form.tags.includes("dance-fitness")) return "dsi";
  if (form.tags.includes("martial-arts")) return "masi";
  return "ais";
}

/** `:root` overrides for a brand (rendered in a <style> tag on branded pages). */
export const brandCss = (b: Brand, embedded: boolean) =>
  `:root{${Object.entries(b.vars)
    .map(([k, v]) => `${k}:${v}`)
    .join(";")}${embedded ? ";--bg:transparent" : ""}}`;

/** Sites allowed to embed the forms in an iframe (CSP frame-ancestors). */
export const EMBED_ORIGINS = Object.values(BRANDS).flatMap((b) => {
  const host = new URL(b.site).host;
  return [`https://${host}`, `https://*.${host}`];
});
