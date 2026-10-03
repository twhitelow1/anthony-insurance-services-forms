import "server-only";
import { createHash, randomBytes } from "node:crypto";
import { createRemoteJWKSet, jwtVerify } from "jose";

/**
 * Microsoft Entra ID (Microsoft 365) sign-in for staff — OpenID Connect
 * authorization-code flow with PKCE, restricted to one tenant and email domain(s).
 */
const LOGIN_BASE = () => (process.env.ENTRA_LOGIN_BASE ?? "https://login.microsoftonline.com").replace(/\/$/, "");

export function entraConfig() {
  const tenantId = process.env.AZURE_TENANT_ID;
  const clientId = process.env.AZURE_CLIENT_ID;
  const clientSecret = process.env.AZURE_CLIENT_SECRET;
  const appUrl = process.env.APP_URL;
  if (!tenantId || !clientId || !clientSecret || !appUrl) return null;
  return {
    tenantId,
    clientId,
    clientSecret,
    redirectUri: `${appUrl.replace(/\/$/, "")}/api/auth/microsoft/callback`,
    allowedDomains: (process.env.STAFF_EMAIL_DOMAINS ?? "anthonyinsuranceservices.com")
      .split(",")
      .map((d) => d.trim().toLowerCase())
      .filter(Boolean),
  };
}

const b64url = (buf: Buffer) => buf.toString("base64url");

export function newAuthRequest() {
  const cfg = entraConfig()!;
  const state = b64url(randomBytes(24));
  const nonce = b64url(randomBytes(24));
  const verifier = b64url(randomBytes(48));
  const challenge = b64url(createHash("sha256").update(verifier).digest());
  const url = new URL(`${LOGIN_BASE()}/${cfg.tenantId}/oauth2/v2.0/authorize`);
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
    prompt: "select_account",
  }).toString();
  return { url: url.toString(), state, nonce, verifier };
}

let jwks: ReturnType<typeof createRemoteJWKSet> | undefined;

export async function completeAuth(code: string, verifier: string, nonce: string) {
  const cfg = entraConfig()!;
  const res = await fetch(`${LOGIN_BASE()}/${cfg.tenantId}/oauth2/v2.0/token`, {
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

  jwks ??= createRemoteJWKSet(new URL(`${LOGIN_BASE()}/${cfg.tenantId}/discovery/v2.0/keys`));
  const { payload } = await jwtVerify(tokens.id_token, jwks, {
    issuer: `${LOGIN_BASE()}/${cfg.tenantId}/v2.0`,
    audience: cfg.clientId,
  });

  if (payload.nonce !== nonce) throw new Error("Nonce mismatch");
  if (payload.tid !== cfg.tenantId) throw new Error("Wrong tenant");

  const email = String(payload.email ?? payload.preferred_username ?? "").toLowerCase();
  const domain = email.split("@")[1];
  if (!domain || !cfg.allowedDomains.includes(domain)) {
    throw new Error(`Account ${email || "(no email)"} is not allowed`);
  }
  return { email, name: String(payload.name ?? email) };
}
