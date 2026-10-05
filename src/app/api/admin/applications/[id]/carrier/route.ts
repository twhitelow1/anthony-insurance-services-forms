import type { NextRequest } from "next/server";
import { getForm } from "@/forms";
import { getSession } from "@/lib/auth/session";
import { addEvent, getApplication } from "@/lib/applications/repo";
import { buildApplicationPdf } from "@/lib/pdf/summary";
import { latestDocument } from "@/lib/applications/documents";
import { buildEml } from "@/lib/mail/eml";
import { emailLayout, subjectFor } from "@/lib/mail";

/**
 * GET ?format=eml (default) → an Outlook draft to the carrier with the application PDF attached.
 * GET ?format=pdf           → just the PDF.
 * Staff only.
 */
export async function GET(req: NextRequest, ctx: RouteContext<"/api/admin/applications/[id]/carrier">) {
  const session = await getSession();
  if (session?.role !== "staff") return new Response("Unauthorized", { status: 401 });

  const { id } = await ctx.params;
  const app = await getApplication(id);
  const form = app && getForm(app.formSlug);
  if (!app || !form) return new Response("Not found", { status: 404 });

  // Prefer the stored PDF (what the GHL link and the client see); build one if none exists yet.
  const stored = await latestDocument(app.id);
  const pdf = stored ? new Uint8Array(stored.content) : await buildApplicationPdf(form, app);
  const base = `${app.reference} ${app.businessName ?? app.applicantName}`.replace(/[^\w .&-]+/g, "").trim();
  const headers = { "Cache-Control": "no-store, private", "X-Content-Type-Options": "nosniff" };

  if (req.nextUrl.searchParams.get("format") === "pdf") {
    return new Response(Buffer.from(pdf), {
      headers: { ...headers, "Content-Type": "application/pdf", "Content-Disposition": `attachment; filename="${base}.pdf"` },
    });
  }

  const effective = typeof app.values.requested_effective_date === "string" ? app.values.requested_effective_date : null;
  const eml = buildEml({
    to: (process.env.CARRIER_EMAIL ?? "").split(",").map((e) => e.trim()).filter(Boolean),
    subject: subjectFor({ subject: `New application: ${app.businessName ?? app.applicantName} (${app.reference})`, encrypt: true }),
    html: emailLayout({
      heading: `New application: ${app.businessName ?? app.applicantName}`,
      paragraphs: [
        `Please find attached a completed ${form.title} for ${app.businessName ?? app.applicantName}${app.state ? ` (${app.state})` : ""}.`,
        ...(effective ? [`Requested effective date: ${effective}.`] : []),
        `Our reference: ${app.reference}. The applicant signed the application electronically on ${new Date(app.createdAt).toDateString()}.`,
        "Please let us know if you need anything else to quote.",
      ],
    }),
    attachments: [{ filename: `${base}.pdf`, contentType: "application/pdf", content: pdf }],
  });

  await addEvent(app.id, "carrier_email_prepared", `staff:${session.email}`, {
    message: "Carrier email draft downloaded",
  });

  return new Response(eml, {
    headers: { ...headers, "Content-Type": "message/rfc822", "Content-Disposition": `attachment; filename="${base}.eml"` },
  });
}
