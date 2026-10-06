import type { NextRequest } from "next/server";
import { getForm } from "@/forms";
import { verify } from "@/lib/auth/session";
import { latestDocument, mainDocument } from "@/lib/applications/documents";
import { getApplication } from "@/lib/applications/repo";
import { pdfResponse } from "@/lib/applications/serve";
import { buildCarrierPdf, carrierFormFor } from "@/lib/pdf/carrier";
import { buildApplicationPdf } from "@/lib/pdf/summary";
import { RECEIPT_AUDIENCE } from "@/lib/applications/receipt";

/**
 * "Download a copy" on the confirmation screen. The token is handed only to the
 * browser that just submitted, and expires after an hour.
 */
export async function GET(req: NextRequest, ctx: RouteContext<"/receipt/[token]">) {
  const { token } = await ctx.params;
  const claims = await verify<{ aid: string }>(token, RECEIPT_AUDIENCE);
  const app = claims && (await getApplication(claims.aid));
  if (!app) return new Response("This link has expired. Sign in to the client portal to download your application.", { status: 404 });

  const download = req.nextUrl.searchParams.get("download") === "1";
  const spec = carrierFormFor(app.formSlug);
  // The stored copies are made right after submission. The answer summary is quicker,
  // so if this click beat the carrier form, build the carrier form now instead.
  const stored = spec ? await latestDocument(app.id, "carrier_form") : await mainDocument(app.id);
  if (stored) return pdfResponse(stored.content, stored.filename, download);

  const form = getForm(app.formSlug);
  const bytes = spec ? (await buildCarrierPdf(spec, app)).bytes : form ? await buildApplicationPdf(form, app) : null;
  if (!bytes) return new Response("Not found", { status: 404 });
  return pdfResponse(bytes, `${app.reference} application.pdf`, download);
}
