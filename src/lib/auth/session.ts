import "server-only";
import { cookies } from "next/headers";
import { redirect } from "next/navigation";
import { jwtVerify, SignJWT } from "jose";

export type Session =
  | { role: "staff"; email: string; name: string }
  | { role: "client"; email: string };

const COOKIE = "ais_session";
const TTL = { staff: 60 * 60 * 10, client: 60 * 60 * 24 } as const; // 10h staff, 24h clients

function secret() {
  const s = process.env.SESSION_SECRET;
  if (!s || s.length < 32) throw new Error("SESSION_SECRET must be set (32+ random characters)");
  return new TextEncoder().encode(s);
}

export const cookieOptions = (maxAge: number) => ({
  httpOnly: true,
  secure: process.env.NODE_ENV === "production",
  sameSite: "lax" as const,
  path: "/",
  maxAge,
});

/** Sign arbitrary short-lived data (sessions, OIDC state). */
export async function sign(payload: Record<string, unknown>, maxAgeSeconds: number, audience: string) {
  return new SignJWT(payload)
    .setProtectedHeader({ alg: "HS256" })
    .setIssuedAt()
    .setExpirationTime(`${maxAgeSeconds}s`)
    .setAudience(audience)
    .sign(secret());
}

export async function verify<T>(token: string | undefined, audience: string): Promise<T | null> {
  if (!token) return null;
  try {
    const { payload } = await jwtVerify(token, secret(), { audience, algorithms: ["HS256"] });
    return payload as T;
  } catch {
    return null;
  }
}

export async function createSession(session: Session) {
  const maxAge = TTL[session.role];
  (await cookies()).set(COOKIE, await sign(session, maxAge, "ais:session"), cookieOptions(maxAge));
}

export async function destroySession() {
  (await cookies()).delete(COOKIE);
}

export async function getSession(): Promise<Session | null> {
  const s = await verify<Session>((await cookies()).get(COOKIE)?.value, "ais:session");
  if (!s || (s.role !== "staff" && s.role !== "client") || typeof s.email !== "string") return null;
  return s.role === "staff" ? { role: "staff", email: s.email, name: s.name } : { role: "client", email: s.email };
}

/** Use at the top of every staff page and staff server action. */
export async function requireStaff(returnTo = "/admin") {
  const s = await getSession();
  if (s?.role !== "staff") redirect(`/admin/login?returnTo=${encodeURIComponent(returnTo)}`);
  return s;
}

/** Use at the top of every client portal page and client server action. */
export async function requireClient() {
  const s = await getSession();
  if (s?.role !== "client") redirect("/portal/login");
  return s;
}

/** Only allow same-site relative redirects. */
export const safeReturnTo = (v: string | null | undefined, fallback: string) =>
  v && v.startsWith("/") && !v.startsWith("//") && !v.startsWith("/\\") ? v : fallback;
