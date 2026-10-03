import { type NextRequest, NextResponse } from "next/server";
import { createSession } from "@/lib/auth/session";

/**
 * LOCAL DEVELOPMENT ONLY: sign in as staff without Microsoft.
 * Disabled unless NODE_ENV is not "production" AND DEV_STAFF_LOGIN=1.
 */
export async function GET(req: NextRequest) {
  if (process.env.NODE_ENV === "production" || process.env.DEV_STAFF_LOGIN !== "1") {
    return new Response("Not found", { status: 404 });
  }
  const email = req.nextUrl.searchParams.get("email") ?? "dev@anthonyinsuranceservices.com";
  await createSession({ role: "staff", email, name: "Dev Staff" });
  return NextResponse.redirect(new URL("/admin", req.nextUrl));
}
