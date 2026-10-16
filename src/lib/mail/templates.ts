import type { FormDefinition } from "@/lib/forms/types";
import { BRANDS, type Brand, defaultBrand } from "@/lib/brands";
import { renderEmail } from "./index";
import { APPLICANT_PORTAL_LINKS } from "@/forms/config";

/**
 * Emails to applicants, branded by the application's own site (AIS, DSI or MASI):
 * name, logo, colors, site link, footer and sender name all come from the brand,
 * so a dance studio's email never shows another brand. Pure functions, so tests
 * can render every form's emails.
 */
export interface RenderedEmail {
  subject: string;
  html: string;
  text: string;
  /** Sender display name; the address is the configured one. */
  fromName: string;
}

export const brandFor = (form: Pick<FormDefinition, "tags" | "brand"> | undefined): Brand =>
  BRANDS[form ? defaultBrand(form) : "ais"];

const portalUrl = (appUrl: string) => `${appUrl.replace(/\/$/, "")}/portal/login`;

export function confirmationEmail(opts: {
  form: FormDefinition;
  app: { reference: string; businessName: string | null; applicantName: string };
  appUrl: string;
  /** Library documents assigned to the form (title, note, link). */
  documents?: { title: string; description?: string | null; url: string }[];
  /** Compliance popups the answers triggered; their sample documents are attached. */
  notices?: { title: string; message: string; documents?: string[] }[];
}): RenderedEmail {
  const { form, app, appUrl, documents = [], notices = [] } = opts;
  const brand = brandFor(form);
  const attached = [...new Set(notices.flatMap((n) => n.documents ?? []))];
  const { html, text } = renderEmail({
    brand,
    heading: "Thanks — your application is in",
    paragraphs: [
      `We've received your ${form.title} for ${app.businessName ?? app.applicantName}. Your reference number is ${app.reference}.`,
      "Our team will review it and be in touch.",
      ...notices.map((n) => `${n.title}: ${n.message}`),
      ...(attached.length ? [`Attached: ${attached.join(", ")}.`] : []),
      ...documents.map((d) => `${d.title}${d.description ? ` (${d.description})` : ""}: ${d.url}`),
      ...(APPLICANT_PORTAL_LINKS
        ? ["You can check its status any time — sign in with this email address and we'll send you a one-time link. No password needed."]
        : []),
    ],
    button: APPLICANT_PORTAL_LINKS ? { label: "Check application status", url: portalUrl(appUrl) } : undefined,
  });
  return { subject: `We received your application (${app.reference})`, html, text, fromName: brand.name };
}

export function statusEmail(opts: {
  form: FormDefinition | undefined;
  app: { reference: string };
  status: { label: string; description: string };
  note?: string;
  appUrl: string;
}): RenderedEmail {
  const brand = brandFor(opts.form);
  const { html, text } = renderEmail({
    brand,
    heading: `Status update: ${opts.status.label}`,
    paragraphs: [opts.status.description, ...(opts.note?.trim() ? [`Note from your agent: ${opts.note.trim()}`] : [])],
    button: APPLICANT_PORTAL_LINKS ? { label: "View your application", url: portalUrl(opts.appUrl) } : undefined,
  });
  return { subject: `Application ${opts.app.reference}: ${opts.status.label}`, html, text, fromName: brand.name };
}

export function resumeEmail(opts: { form: FormDefinition; businessName: string | null; url: string }): RenderedEmail {
  const brand = brandFor(opts.form);
  const { html, text } = renderEmail({
    brand,
    heading: "Pick up where you left off",
    paragraphs: [
      `Your ${opts.form.title}${opts.businessName ? ` for ${opts.businessName}` : ""} is saved.`,
      "Use the button below to finish it on any device. Keep this email private: the link opens your saved answers.",
    ],
    button: { label: "Finish my application", url: opts.url },
  });
  return { subject: `Finish your ${opts.form.title}`, html, text, fromName: brand.name };
}
