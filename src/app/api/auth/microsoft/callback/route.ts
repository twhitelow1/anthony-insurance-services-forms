import { type NextRequest, NextResponse } from "next/server";
import { completeAuth } from "@/lib/auth/entra";
import { createSession, safeReturnTo, verify } from "@/lib/auth/session";
import { isStaffEmail } from "@/lib/auth/staff";

export async function GET(req: NextRequest) {
  const flow = await verify<{ state: string; nonce: string; verifier: string; returnTo: string; silent?: boolean }>(
    req.cookies.get("ais_oidc")?.value,
    "ais:oidc",
  );
  const returnTo = safeReturnTo(flow?.returnTo ?? null, "/admin");

  // Back to the login page with automatic Microsoft sign-in turned off (sso=0), so it can't loop.
  const toLogin = (reason?: string) => {
    const url = new URL("/admin/login", req.nextUrl);
    url.searchParams.set("sso", "0");
    if (returnTo !== "/admin") url.searchParams.set("returnTo", returnTo);
    if (reason) url.searchParams.set("error", reason);
    const res = NextResponse.redirect(url);
    res.cookies.delete("ais_oidc");
    return res;
  };
  const fail = (reason: string) => toLogin(reason);

  const params = req.nextUrl.searchParams;
  if (params.get("error")) {
    // Silent attempt with no usable Microsoft session in this browser: quietly offer the email sign-in.
    if (flow?.silent) return toLogin();
    return fail(params.get("error_description") ?? "Sign-in was cancelled.");
  }

  const code = params.get("code");
  if (!flow || !code || params.get("state") !== flow.state) return fail("Your sign-in session expired. Please try again.");

  try {
    const user = await completeAuth(code, flow.verifier, flow.nonce);
    // Same admin list as the email link: without this the session is made and then dropped on the next request.
    if (!(await isStaffEmail(user.email))) {
      console.warn("[auth] staff sign-in rejected: not on the admin list");
      return fail("That Microsoft account isn't on the Admins list yet. Ask an admin to add it in Admin → Settings.");
    }
    await createSession({ role: "staff", email: user.email, name: user.name });
  } catch (err) {
    console.warn("[auth] staff sign-in rejected:", err instanceof Error ? err.message : err);
    return fail("That account isn't allowed to access the admin portal.");
  }
  const res = NextResponse.redirect(new URL(returnTo, req.nextUrl));
  res.cookies.delete("ais_oidc");
  return res;
}
