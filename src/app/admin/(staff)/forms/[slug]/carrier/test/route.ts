import { desc, eq } from "drizzle-orm";
import type { NextRequest } from "next/server";
import { getForm } from "@/forms";
import { getSession } from "@/lib/auth/session";
import { carrierPdfFor } from "@/lib/applications/carrier-templates";
import { getApplication } from "@/lib/applications/repo";
import { pdfResponse } from "@/lib/applications/serve";
import { getDb, schema } from "@/lib/db";

/** Staff: the carrier PDF filled from this form's newest application, to check the matching. Not saved anywhere. */
export async function GET(_req: NextRequest, ctx: RouteContext<"/admin/forms/[slug]/carrier/test">) {
  const session = await getSession();
  if (session?.role !== "staff") return new Response("Unauthorized", { status: 401 });
  const { slug } = await ctx.params;
  if (!getForm(slug)) return new Response("Not found", { status: 404 });
  const carrier = await carrierPdfFor({ formSlug: slug });
  if (!carrier) return new Response("This form has no carrier PDF.", { status: 404 });
  const db = await getDb();
  const [latest] = await db
    .select({ id: schema.applications.id })
    .from(schema.applications)
    .where(eq(schema.applications.formSlug, slug))
    .orderBy(desc(schema.applications.createdAt))
    .limit(1);
  const app = latest && (await getApplication(latest.id));
  if (!app) return new Response("There are no applications on this form yet to test with.", { status: 404 });
  const { bytes } = await carrier.build(app);
  return pdfResponse(bytes, `TEST ${app.reference} carrier application.pdf`, false);
}
