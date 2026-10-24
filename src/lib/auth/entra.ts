import "server-only";
import { createHash, randomBytes } from "node:crypto";
import { type JWTVerifyGetKey, createRemoteJWKSet, jwtVerify } from "jose";

/**
 * Microsoft Entra ID (Microsoft 365) sign-in for staff — OpenID Connect
 * authorization-code flow with PKCE. Multi-tenant: any organisation's Microsoft 365
 * account can sign in, and the Admins list (emails or domains, in Admin → Settings)
 * decides who gets in. Personal Microsoft accounts are refused.
 */
const LOGIN_BASE = () => (process.env.ENTRA_LOGIN_BASE ?? "https://login.microsoftonline.com").replace(/\/$/, "");

/** Work and school accounts from any tenant; never personal Microsoft accounts. */
const AUTHORITY = "organizations";
/** The tenant Microsoft uses for personal accounts (outlook.com, hotmail.com…). */
const CONSUMER_TENANT = "9188040d-6c67-4c5b-b112-36a304b66dad";
const GUID_RE = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

export function entraConfig() {
  const clientId = process.env.AZURE_CLIENT_ID;
  const clientSecret = process.env.AZURE_CLIENT_SECRET;
  const appUrl = process.env.APP_URL;
  if (!clientId || !clientSecret || !appUrl) return null;
  return {
    clientId,
    clientSecret,
    redirectUri: `${appUrl.replace(/\/$/, "")}/api/auth/microsoft/callback`,
  };
}

const b64url = (buf: Buffer) => buf.toString("base64url");

/**
 * `silent` asks Microsoft not to show any screen (prompt=none): it signs straight in when the
 * browser already has a Microsoft 365 session, and otherwise comes back with an error
 * (e.g. login_required) so the app can fall back to the email sign-in.
 */
export function newAuthRequest(silent = false) {
  const cfg = entraConfig()!;
  const state = b64url(randomBytes(24));
  const nonce = b64url(randomBytes(24));
  const verifier = b64url(randomBytes(48));
  const challenge = b64url(createHash("sha256").update(verifier).digest());
  const url = new URL(`${LOGIN_BASE()}/${AUTHORITY}/oauth2/v2.0/authorize`);
  url.search = new URLSearchParams({
    client_id: cfg.clientId,
    response_type: "code",
    redirect_uri: cfg.redirectUri,
    response_mode: "query",
    scope: "openid profile email",
    state,
    nonce,
    code_challenge: challenge,
    code_challenge_method: "S256",
    prompt: silent ? "none" : "select_account",
  }).toString();
  return { url: url.toString(), state, nonce, verifier };
}

let jwks: ReturnType<typeof createRemoteJWKSet> | undefined;

export async function completeAuth(code: string, verifier: string, nonce: string) {
  const cfg = entraConfig()!;
  const res = await fetch(`${LOGIN_BASE()}/${AUTHORITY}/oauth2/v2.0/token`, {
    method: "POST",
    headers: { "Content-Type": "application/x-www-form-urlencoded" },
    body: new URLSearchParams({
      client_id: cfg.clientId,
      client_secret: cfg.clientSecret,
      grant_type: "authorization_code",
      code,
      redirect_uri: cfg.redirectUri,
      code_verifier: verifier,
      scope: "openid profile email",
    }),
    cache: "no-store",
  });
  const tokens = await res.json().catch(() => ({}));
  if (!res.ok || typeof tokens.id_token !== "string") {
    throw new Error(`Token exchange failed (${res.status}): ${tokens.error_description ?? tokens.error ?? "unknown"}`);
  }

  jwks ??= createRemoteJWKSet(new URL(`${LOGIN_BASE()}/common/discovery/v2.0/keys`));
  return verifyIdToken(tokens.id_token, jwks, { clientId: cfg.clientId, nonce });
}

/**
 * Checks a Microsoft ID token from any tenant. The signing keys are shared by every tenant,
 * so the issuer is checked against the token's own tenant ID. Exported for tests.
 */
export async function verifyIdToken(
  idToken: string,
  keys: JWTVerifyGetKey,
  { clientId, nonce }: { clientId: string; nonce: string },
) {
  const { payload } = await jwtVerify(idToken, keys, { audience: clientId });
  const tid = typeof payload.tid === "string" ? payload.tid : "";
  if (!GUID_RE.test(tid)) throw new Error("Missing tenant");
  if (tid === CONSUMER_TENANT) throw new Error("Personal Microsoft accounts can't sign in");
  if (payload.iss !== `${LOGIN_BASE()}/${tid}/v2.0`) throw new Error("Wrong issuer");
  if (payload.nonce !== nonce) throw new Error("Nonce mismatch");

  // Only the `email` claim is trusted: Microsoft leaves it out when the tenant hasn't verified
  // the domain, and `xms_edov` (if requested) says so outright. `preferred_username` is
  // tenant-controlled, so it's never used to decide who gets in.
  if (payload.xms_edov === false || payload.xms_edov === "0" || payload.xms_edov === "false") {
    throw new Error("Email domain not verified by the account's organisation");
  }
  const email = typeof payload.email === "string" ? payload.email.trim().toLowerCase() : "";
  if (!email.includes("@")) throw new Error("No verified email on the Microsoft account");
  return { email, name: String(payload.name ?? email) };
}
