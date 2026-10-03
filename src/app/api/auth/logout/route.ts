import { type NextRequest, NextResponse } from "next/server";
import { destroySession, getSession } from "@/lib/auth/session";

export async function POST(req: NextRequest) {
  const session = await getSession();
  await destroySession();
  return NextResponse.redirect(new URL(session?.role === "staff" ? "/admin/login" : "/portal/login", req.nextUrl), 303);
}
