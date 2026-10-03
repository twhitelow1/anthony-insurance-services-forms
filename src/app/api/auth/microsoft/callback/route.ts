import { type NextRequest, NextResponse } from "next/server";
import { completeAuth } from "@/lib/auth/entra";
import { createSession, safeReturnTo, verify } from "@/lib/auth/session";

export async function GET(req: NextRequest) {
  const fail = (reason: string) => {
    const url = new URL("/admin/login", req.nextUrl);
    url.searchParams.set("error", reason);
    const res = NextResponse.redirect(url);
    res.cookies.delete("ais_oidc");
    return res;
  };

  const params = req.nextUrl.searchParams;
  if (params.get("error")) return fail(params.get("error_description") ?? "Sign-in was cancelled.");

  const flow = await verify<{ state: string; nonce: string; verifier: string; returnTo: string }>(
    req.cookies.get("ais_oidc")?.value,
    "ais:oidc",
  );
  const code = params.get("code");
  if (!flow || !code || params.get("state") !== flow.state) return fail("Your sign-in session expired. Please try again.");

  try {
    const user = await completeAuth(code, flow.verifier, flow.nonce);
    await createSession({ role: "staff", email: user.email, name: user.name });
  } catch (err) {
    console.warn("[auth] staff sign-in rejected:", err instanceof Error ? err.message : err);
    return fail("That account isn't allowed to access the admin portal.");
  }
  const res = NextResponse.redirect(new URL(safeReturnTo(flow.returnTo, "/admin"), req.nextUrl));
  res.cookies.delete("ais_oidc");
  return res;
}
