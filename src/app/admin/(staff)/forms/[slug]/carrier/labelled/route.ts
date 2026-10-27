import type { NextRequest } from "next/server";
import { getSession } from "@/lib/auth/session";
import { getCarrierTemplate } from "@/lib/applications/carrier-templates";
import { pdfResponse } from "@/lib/applications/serve";
import { labelledPdf } from "@/lib/pdf/carrier/uploaded";

/** Staff: the uploaded carrier PDF with each box's name printed on it, to help match the boxes. */
export async function GET(_req: NextRequest, ctx: RouteContext<"/admin/forms/[slug]/carrier/labelled">) {
  const session = await getSession();
  if (session?.role !== "staff") return new Response("Unauthorized", { status: 401 });
  const { slug } = await ctx.params;
  const tpl = await getCarrierTemplate(slug);
  if (!tpl) return new Response("This form has no uploaded carrier PDF.", { status: 404 });
  return pdfResponse(await labelledPdf(tpl.content), `${tpl.name} - box names.pdf`, false);
}
