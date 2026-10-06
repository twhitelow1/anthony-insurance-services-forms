import { afterEach, describe, expect, it, vi } from "vitest";
import { PDFDocument } from "pdf-lib";
import { sportsFacilityApplication as form } from "@/forms/sports-facility-application";
import { createApplication } from "@/lib/applications/repo";
import { pruneValues } from "@/lib/forms/validate";
import * as mail from "@/lib/mail";
import { buildEml } from "@/lib/mail/eml";
import { buildApplicationPdf } from "@/lib/pdf/summary";
import { consumeMagicLink, isStaffEmail, requestMagicLink, requestStaffLink } from "./magic-link";

const PNG = "data:image/png;base64,iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAQAAAC1HAwCAAAAC0lEQVR42mNkYAAAAAYAAjCB0C8AAAAASUVORK5CYII=";
const tokenFrom = (html: string, path: string) =>
  new URL(html.match(new RegExp(`https://forms\\.example\\.com${path}\\?token=[\\w-]+`))![0]).searchParams.get("token")!;

afterEach(() => {
  vi.restoreAllMocks();
  vi.unstubAllEnvs();
});

describe("staff sign-in links", () => {
  it("recognizes staff by domain, or by an explicit list when set", () => {
    expect(isStaffEmail("Amy@AnthonyInsuranceServices.com")).toBe(true);
    expect(isStaffEmail("amy@gmail.com")).toBe(false);
    expect(isStaffEmail("amy@anthonyinsuranceservices.com.evil.com")).toBe(false);
    vi.stubEnv("STAFF_EMAILS", "melanie@anthonyinsuranceservices.com");
    expect(isStaffEmail("amy@anthonyinsuranceservices.com")).toBe(false);
    expect(isStaffEmail("melanie@anthonyinsuranceservices.com")).toBe(true);
  });

  it("emails only staff, and staff and client links are not interchangeable", async () => {
    const send = vi.spyOn(mail, "sendMail").mockResolvedValue();
    await requestStaffLink("someone@gmail.com");
    expect(send).not.toHaveBeenCalled();

    await requestStaffLink("amy@anthonyinsuranceservices.com");
    const staffToken = tokenFrom(send.mock.calls[0][0].html, "/admin/verify");
    expect(await consumeMagicLink(staffToken, "client")).toBeNull(); // wrong portal
    expect(await consumeMagicLink(staffToken, "staff")).toBe("amy@anthonyinsuranceservices.com");
    expect(await consumeMagicLink(staffToken, "staff")).toBeNull(); // single use

    // A client link can't open the admin portal.
    await createApplication(form, pruneValues(form, { email: "client@example.com", first_name: "C" }), {});
    await requestMagicLink("client@example.com");
    const clientToken = tokenFrom(send.mock.calls[1][0].html, "/portal/verify");
    expect(await consumeMagicLink(clientToken, "staff")).toBeNull();
    expect(await consumeMagicLink(clientToken, "client")).toBe("client@example.com");
  });

  it("revokes an issued staff link if the person is removed from STAFF_EMAILS", async () => {
    const send = vi.spyOn(mail, "sendMail").mockResolvedValue();
    await requestStaffLink("bob@anthonyinsuranceservices.com");
    const token = tokenFrom(send.mock.calls[0][0].html, "/admin/verify");
    vi.stubEnv("STAFF_EMAILS", "melanie@anthonyinsuranceservices.com");
    expect(await consumeMagicLink(token, "staff")).toBeNull();
  });
});

describe("Resend provider", () => {
  it("sends through Resend with the encryption tag and attachments", async () => {
    vi.stubEnv("RESEND_API_KEY", "re_test");
    vi.stubEnv("MAIL_FROM", "Anthony Insurance <applications@anthonyinsuranceservices.com>");
    const fetchMock = vi.spyOn(globalThis, "fetch").mockResolvedValue(new Response("{}", { status: 200 }));
    await mail.sendMail({
      to: "carrier@example.com",
      subject: "New application",
      html: "<p>hi</p>",
      encrypt: true,
      attachments: [{ name: "a.pdf", contentType: "application/pdf", content: new Uint8Array([37, 80, 68, 70]) }],
    });
    const [url, init] = fetchMock.mock.calls[0] as [string, RequestInit];
    expect(url).toBe("https://api.resend.com/emails");
    expect((init.headers as Record<string, string>).Authorization).toBe("Bearer re_test");
    const body = JSON.parse(String(init.body));
    expect(body).toMatchObject({ to: ["carrier@example.com"], subject: "[encrypt] New application", from: expect.stringContaining("applications@") });
    expect(body.attachments[0]).toEqual({ filename: "a.pdf", content: "JVBERg==", content_type: "application/pdf" });
  });

  it("reports Resend errors", async () => {
    vi.stubEnv("RESEND_API_KEY", "re_test");
    vi.stubEnv("MAIL_FROM", "x@y.com");
    vi.spyOn(globalThis, "fetch").mockResolvedValue(new Response("domain not verified", { status: 403 }));
    await expect(mail.sendMail({ to: "a@b.com", subject: "s", html: "h" })).rejects.toThrow(/403.*domain not verified/);
  });
});

describe("carrier draft", () => {
  it("builds a PDF of every answer plus the signature", async () => {
    const app = await createApplication(
      form,
      pruneValues(form, {
        first_name: "Jane",
        last_name: "Doe",
        email: "jane@example.com",
        legal_business_name: "Flip “Kids” Gymnastics — Austin ✓",
        business_description: "A ".repeat(400),
        signature: PNG,
      }),
      { ip: "1.2.3.4" },
    );
    const bytes = await buildApplicationPdf(form, app);
    const doc = await PDFDocument.load(bytes);
    expect(doc.getPageCount()).toBeGreaterThanOrEqual(1);
    expect(doc.getTitle()).toContain(app.reference);
  });

  it("builds an Outlook draft (.eml) with the attachment", () => {
    const eml = buildEml({
      to: ["uw@carrier.com"],
      subject: "[encrypt] New application: Flip Kids — Austin",
      html: "<p>Hello</p>",
      attachments: [{ filename: "AIS-1 Flip Kids.pdf", contentType: "application/pdf", content: new Uint8Array([37, 80, 68, 70]) }],
    });
    expect(eml).toMatch(/^To: uw@carrier\.com\r\n/);
    expect(eml).toContain("X-Unsent: 1\r\n");
    expect(eml).toContain("Subject: =?UTF-8?B?"); // non-ASCII dash is encoded
    expect(eml).toContain('Content-Disposition: attachment; filename="AIS-1 Flip Kids.pdf"');
    expect(eml).toContain("JVBERg==");
    expect(eml.trimEnd()).toMatch(/--$/);
  });
});
