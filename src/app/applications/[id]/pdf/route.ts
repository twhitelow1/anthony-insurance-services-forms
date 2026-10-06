import { type NextRequest, NextResponse } from "next/server";
import { getSession } from "@/lib/auth/session";
import { mainDocument } from "@/lib/applications/documents";
import { getApplication } from "@/lib/applications/repo";
import { pdfResponse } from "@/lib/applications/serve";

/**
 * The application's current PDF (the filled carrier application, or the summary
 * if there's none). This link never changes, so it's the one stored in GHL: after
 * an edit it opens the new version. Staff can open any; an applicant only theirs.
 */
export async function GET(req: NextRequest, ctx: RouteContext<"/applications/[id]/pdf">) {
  const { id } = await ctx.params;
  const session = await getSession();
  if (!session) {
    const login = new URL("/admin/login", req.nextUrl);
    login.searchParams.set("returnTo", `/applications/${id}/pdf`);
    return NextResponse.redirect(login);
  }
  const app = await getApplication(id);
  if (!app || (session.role === "client" && session.email !== app.applicantEmail)) {
    return new Response("Not found", { status: 404 });
  }
  const doc = await mainDocument(app.id);
  if (!doc) return new Response("The PDF hasn't been created yet. Try again in a minute.", { status: 404 });
  return pdfResponse(doc.content, doc.filename, req.nextUrl.searchParams.get("download") === "1");
}
