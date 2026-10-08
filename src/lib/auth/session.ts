import "server-only";
import { cookies } from "next/headers";
import { redirect } from "next/navigation";
import { jwtVerify, SignJWT } from "jose";

export type Session =
  | { role: "staff"; email: string; name: string }
  | { role: "client"; email: string };

const COOKIE = "ais_session";
const TTL = { staff: 60 * 60 * 10, client: 60 * 60 * 24 } as const; // 10h staff, 24h clients

/**
 * TESTING ONLY. With OPEN_ACCESS=1 there is no sign-in: everyone is treated as
 * staff and can see every application and PDF. Remove the variable to turn
 * sign-in back on.
 */
export const openAccess = () => /^(1|true|yes|on)$/i.test((process.env.OPEN_ACCESS ?? "").trim().replace(/^["']|["']$/g, ""));
const OPEN_ACCESS_USER = { role: "staff", email: "open-access@test", name: "Open access (testing)" } as const;

function secret() {
  const s = process.env.SESSION_SECRET;
  if (!s || s.length < 32) {
    // Nothing is protected in open-access mode, so a fixed key is fine there.
    if (openAccess()) return new TextEncoder().encode("open-access-mode-no-secret-configured-000000");
    throw new Error("SESSION_SECRET must be set (32+ random characters)");
  }
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
  const jar = await cookies();
  jar.delete(COOKIE);
  jar.delete(VIEW_AS_COOKIE);
}

export async function getSession(): Promise<Session | null> {
  if (openAccess()) return OPEN_ACCESS_USER;
  const s = await verify<Session>((await cookies()).get(COOKIE)?.value, "ais:session");
  if (!s || (s.role !== "staff" && s.role !== "client") || typeof s.email !== "string") return null;
  if (s.role === "staff") {
    // Re-checked on every request, so removing an admin in Settings signs them out right away.
    const { isStaffEmail } = await import("./staff");
    return (await isStaffEmail(s.email)) ? { role: "staff", email: s.email, name: s.name } : null;
  }
  return { role: "client", email: s.email };
}

/** Use at the top of every staff page and staff server action. */
export async function requireStaff(returnTo = "/admin") {
  const s = await getSession();
  if (s?.role !== "staff") redirect(`/admin/login?returnTo=${encodeURIComponent(returnTo)}`);
  return s;
}

const VIEW_AS_COOKIE = "ais_view_as";

/** Who the client portal is showing. Staff can use the portal too ("user mode"). */
export type PortalViewer =
  | { staff: false; email: string }
  | { staff: true; email: string; staffEmail: string; previewing: boolean };

/**
 * Use at the top of every client portal page. Clients see their own applications.
 * Staff see their own too, or a specific applicant's after "View as applicant".
 */
export async function requirePortalViewer(): Promise<PortalViewer> {
  const s = await getSession();
  if (s?.role === "client") return { staff: false, email: s.email };
  if (s?.role === "staff") {
    const raw = (await cookies()).get(VIEW_AS_COOKIE)?.value;
    const as = await verify<{ email: string; by: string }>(raw, "ais:view-as");
    // Only honoured for the staff member who set it.
    const email = as && as.by === s.email ? as.email : null;
    return { staff: true, email: email ?? s.email, staffEmail: s.email, previewing: !!email };
  }
  redirect("/portal/login");
}

/** Staff only: show the portal as `email` sees it, or as themselves when null. */
export async function setPortalViewAs(staffEmail: string, email: string | null) {
  const jar = await cookies();
  if (!email) {
    jar.delete(VIEW_AS_COOKIE);
    return;
  }
  const maxAge = TTL.staff;
  jar.set(VIEW_AS_COOKIE, await sign({ email, by: staffEmail }, maxAge, "ais:view-as"), cookieOptions(maxAge));
}

/** Only allow same-site relative redirects. */
export const safeReturnTo = (v: string | null | undefined, fallback: string) =>
  v && v.startsWith("/") && !v.startsWith("//") && !v.startsWith("/\\") ? v : fallback;
