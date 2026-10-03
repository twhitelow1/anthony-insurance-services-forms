import { type NextRequest, NextResponse } from "next/server";
import { entraConfig, newAuthRequest } from "@/lib/auth/entra";
import { cookieOptions, safeReturnTo, sign } from "@/lib/auth/session";

export async function GET(req: NextRequest) {
  if (!entraConfig()) return new Response("Microsoft sign-in is not configured.", { status: 503 });
  const returnTo = safeReturnTo(req.nextUrl.searchParams.get("returnTo"), "/admin");
  const { url, state, nonce, verifier } = newAuthRequest();
  const res = NextResponse.redirect(url);
  // State, nonce and PKCE verifier ride in a short-lived signed cookie.
  res.cookies.set("ais_oidc", await sign({ state, nonce, verifier, returnTo }, 600, "ais:oidc"), cookieOptions(600));
  return res;
}
