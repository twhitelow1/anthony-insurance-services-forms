import type { NextRequest } from "next/server";
import { timingSafeEqual } from "node:crypto";
import { forms, getForm } from "@/forms";
import { GhlError, ghlConfig, listCustomFields } from "@/lib/ghl/client";
import { mappingReport } from "@/lib/ghl/mapping";

/**
 * GET /api/admin/ghl-mapping?form=<slug>
 * Header: Authorization: Bearer <ADMIN_SECRET>   (or ?secret=<ADMIN_SECRET> from a browser)
 *
 * Shows how every form field resolves against the live GHL custom fields:
 * which matched, which are MISSING / AMBIGUOUS, and which GHL fields are unused.
 */
export async function GET(req: NextRequest) {
  const secret = process.env.ADMIN_SECRET;
  const given =
    req.headers.get("authorization")?.replace(/^Bearer\s+/i, "") ?? req.nextUrl.searchParams.get("secret") ?? "";
  if (!secret || given.length !== secret.length || !timingSafeEqual(Buffer.from(given), Buffer.from(secret))) {
    return Response.json({ error: "Unauthorized" }, { status: 401 });
  }
  if (!ghlConfig()) return Response.json({ error: "GHL_API_TOKEN / GHL_LOCATION_ID not set" }, { status: 500 });

  const slug = req.nextUrl.searchParams.get("form");
  const targets = slug ? [getForm(slug)].filter((f) => !!f) : Object.values(forms);
  if (!targets.length) return Response.json({ error: `Unknown form "${slug}"` }, { status: 404 });

  try {
    const customFields = await listCustomFields();
    return Response.json({
      ghlCustomFieldCount: customFields.length,
      reports: targets.map((f) => mappingReport(f, customFields)),
    });
  } catch (err) {
    const e = err instanceof GhlError ? { message: err.message, status: err.status, body: err.body } : String(err);
    return Response.json({ error: e }, { status: 502 });
  }
}
