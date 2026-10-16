import { describe, expect, it } from "vitest";
import { forms } from "@/forms";
import { BRANDS, brandHost, defaultBrand } from "@/lib/brands";
import { confirmationEmail, resumeEmail, statusEmail } from "./templates";
import { htmlToText, renderEmail } from "./index";
import { withFromName } from "./resend";

const APP_URL = "https://forms.example.com";
const app = { reference: "AIS-TEST-0001", businessName: "Test Studio LLC", applicantName: "Pat Lee" };

/** Every form's applicant emails, rendered. */
const rendered = Object.values(forms).flatMap((form) => [
  { form, kind: "confirmation", email: confirmationEmail({ form, app, appUrl: APP_URL }) },
  { form, kind: "status", email: statusEmail({ form, app, status: { label: "In review", description: "We're reviewing it." }, appUrl: APP_URL }) },
  { form, kind: "resume", email: resumeEmail({ form, businessName: app.businessName, url: `${APP_URL}/forms/${form.slug}?resume=x` }) },
]);

describe("applicant emails are branded per application", () => {
  it.each(rendered.map((r) => [`${r.form.slug} ${r.kind}`, r] as const))("%s", (_, { form, email }) => {
    const brand = BRANDS[defaultBrand(form)];
    for (const part of [email.html, email.text]) {
      expect(part).toContain(brand.name);
      expect(part).toContain(brandHost(brand));
    }
    expect(email.fromName).toBe(brand.name);
    expect(email.html).toContain(`href="${brand.site}"`);
    expect(email.html).toContain(`border-top:4px solid ${brand.vars["--accent"]}`);
    if (brand.logo) expect(email.html).toContain(brand.logo);
    // No other brand's name, site or logo.
    for (const other of Object.values(BRANDS)) {
      if (other.id === brand.id) continue;
      for (const part of [email.html, email.text]) {
        expect(part).not.toContain(brandHost(other));
        if (other.logo) expect(part).not.toContain(other.logo);
        // DSI and MASI emails say they're programs of Anthony Insurance Services; nothing else crosses over.
        if (other.id !== "ais") expect(part).not.toContain(other.name);
      }
    }
    // Applicants aren't sent to the portal yet (APPLICANT_PORTAL_LINKS is off).
    for (const part of [email.html, email.text]) expect(part).not.toContain("/portal");
  });

  it("brands dance, aerial and gymnastics as DSI and martial arts and boxing as MASI", () => {
    expect(defaultBrand(forms["aerial-yoga-studio-application"])).toBe("dsi");
    expect(defaultBrand(forms["gymnastics-application"])).toBe("dsi");
    expect(defaultBrand(forms["boxing-gym-application"])).toBe("masi");
    expect(defaultBrand(forms["martial-arts-instructor-application"])).toBe("masi");
    expect(defaultBrand(forms["sports-facility-application"])).toBe("ais");
  });

  it("lists compliance attachments and library documents in the confirmation", () => {
    const form = forms["gymnastics-application"];
    const email = confirmationEmail({
      form,
      app,
      appUrl: APP_URL,
      notices: [{ title: "Required before coverage starts", message: "A policy must be implemented.", documents: ["sample.pdf"] }],
      documents: [{ title: "Sample waiver", url: `${APP_URL}/library/1` }],
    });
    expect(email.text).toContain("Attached: sample.pdf.");
    expect(email.text).toContain("Sample waiver");
  });
});

describe("email plumbing", () => {
  it("swaps the sender's display name but keeps the verified address", () => {
    expect(withFromName("Anthony Insurance Services <applications@anthonyinsuranceservices.com>", "Dance Studio Insurance")).toBe(
      "Dance Studio Insurance <applications@anthonyinsuranceservices.com>",
    );
    expect(withFromName("applications@anthonyinsuranceservices.com", "Martial Arts School Insurance")).toBe(
      "Martial Arts School Insurance <applications@anthonyinsuranceservices.com>",
    );
    expect(withFromName("A <a@b.com>", undefined)).toBe("A <a@b.com>");
  });

  it("derives a readable plain-text version from HTML", () => {
    const { html } = renderEmail({ heading: "Hi & welcome", paragraphs: ["Line one."], button: { label: "Go", url: "https://x.example/a" } });
    const text = htmlToText(html);
    expect(text).toContain("Hi & welcome");
    expect(text).toContain("Line one.");
    expect(text).toContain("https://x.example/a");
    expect(text).not.toMatch(/<[a-z]/i);
  });
});
