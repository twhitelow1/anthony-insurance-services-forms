import { type NextRequest, NextResponse } from "next/server";
import { getSession } from "@/lib/auth/session";
import { getDocument } from "@/lib/applications/documents";
import { getApplication } from "@/lib/applications/repo";

/**
 * Serves a stored application document. Staff can open any; an applicant only
 * their own. Signed-out visitors (e.g. staff clicking the link in GHL) are sent
 * to staff sign-in and brought back here afterwards.
 */
export async function GET(req: NextRequest, ctx: RouteContext<"/documents/[id]">) {
  const { id } = await ctx.params;
  const session = await getSession();
  if (!session) {
    const login = new URL("/admin/login", req.nextUrl);
    login.searchParams.set("returnTo", `/documents/${id}`);
    return NextResponse.redirect(login);
  }

  const doc = await getDocument(id);
  const app = doc && (await getApplication(doc.applicationId));
  // Same 404 for "doesn't exist" and "not yours".
  if (!doc || !app || (session.role === "client" && session.email !== app.applicantEmail)) {
    return new Response("Not found", { status: 404 });
  }

  const download = req.nextUrl.searchParams.get("download") === "1";
  return new Response(new Uint8Array(doc.content), {
    headers: {
      "Content-Type": doc.contentType,
      "Content-Disposition": `${download ? "attachment" : "inline"}; filename="${doc.filename.replace(/["\\]/g, "")}"`,
      "Cache-Control": "private, no-store",
      "X-Content-Type-Options": "nosniff",
      "Content-Security-Policy": "default-src 'none'; sandbox",
    },
  });
}
