import { type NextRequest, NextResponse } from "next/server";
import { destroySession, getSession } from "@/lib/auth/session";

export async function POST(req: NextRequest) {
  const session = await getSession();
  await destroySession();
  // sso=0: don't sign straight back in with Microsoft right after signing out.
  return NextResponse.redirect(new URL(session?.role === "staff" ? "/admin/login?sso=0" : "/portal/login", req.nextUrl), 303);
}
