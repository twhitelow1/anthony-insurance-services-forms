import "server-only";
import { createHash, randomBytes } from "node:crypto";
import { and, count, eq, gt, isNull } from "drizzle-orm";
import { getDb, schema } from "@/lib/db";
import { hasApplications, normalizeEmail } from "@/lib/applications/repo";
import { emailLayout, sendMail } from "@/lib/mail";
import { safeReturnTo } from "./session";

/**
 * One-time sign-in links, for clients (portal) and staff (admin).
 * Only a SHA-256 hash of each token is stored; tokens expire, work once, are
 * rate-limited per email, and a client link can never open the admin portal.
 */

const { loginTokens } = schema;
const TOKEN_TTL_MINUTES = 20;
const MAX_LINKS_PER_15_MIN = 3;

export type LinkPurpose = "client" | "staff";

const hash = (token: string) => createHash("sha256").update(token).digest("hex");
const appUrl = () => (process.env.APP_URL ?? "http://localhost:3000").replace(/\/$/, "");
const EMAIL_RE = /^[^\s@]+@[^\s@]+\.[^\s@]+$/;

/**
 * Who counts as staff: anyone on STAFF_EMAILS if that list is set; otherwise
 * any address at one of STAFF_EMAIL_DOMAINS (default anthonyinsuranceservices.com).
 */
export function isStaffEmail(rawEmail: string): boolean {
  const email = normalizeEmail(rawEmail);
  if (!EMAIL_RE.test(email)) return false;
  const list = (process.env.STAFF_EMAILS ?? "")
    .split(",")
    .map((e) => normalizeEmail(e))
    .filter(Boolean);
  if (list.length) return list.includes(email);
  const domains = (process.env.STAFF_EMAIL_DOMAINS ?? "anthonyinsuranceservices.com")
    .split(",")
    .map((d) => d.trim().toLowerCase())
    .filter(Boolean);
  return domains.includes(email.split("@")[1]);
}

async function issueLink(email: string, purpose: LinkPurpose, returnTo?: string): Promise<string | null> {
  const db = await getDb();
  const [{ n }] = await db
    .select({ n: count() })
    .from(loginTokens)
    .where(
      and(
        eq(loginTokens.email, email),
        eq(loginTokens.purpose, purpose),
        gt(loginTokens.createdAt, new Date(Date.now() - 15 * 60_000)),
      ),
    );
  if (n >= MAX_LINKS_PER_15_MIN) return null;

  const token = randomBytes(32).toString("base64url");
  await db.insert(loginTokens).values({
    tokenHash: hash(token),
    email,
    purpose,
    expiresAt: new Date(Date.now() + TOKEN_TTL_MINUTES * 60_000),
  });
  // The link opens a confirmation page; the token is only spent when the person
  // clicks the button. Email security scanners that pre-open links can't burn it.
  const path = purpose === "staff" ? "/admin/verify" : "/portal/verify";
  const next = returnTo ? `&returnTo=${encodeURIComponent(safeReturnTo(returnTo, "/admin"))}` : "";
  return `${appUrl()}${path}?token=${token}${next}`;
}

/**
 * Client link — only sent if this email has applications. Callers always show
 * the same "check your email" message, so nobody can probe which emails exist.
 */
export async function requestMagicLink(rawEmail: string): Promise<void> {
  const email = normalizeEmail(rawEmail);
  if (!EMAIL_RE.test(email) || !(await hasApplications(email))) return;
  const url = await issueLink(email, "client");
  if (!url) return;
  await sendMail({
    to: email,
    subject: "Your sign-in link — Anthony Insurance Services",
    html: emailLayout({
      heading: "Sign in to check your application",
      paragraphs: [
        `Use the button below to sign in. This link works once and expires in ${TOKEN_TTL_MINUTES} minutes.`,
        "If you didn't request this, you can ignore this email.",
      ],
      button: { label: "Sign in", url },
    }),
  });
}

/** Staff link — only sent to staff addresses (see isStaffEmail). Same silent response otherwise. */
export async function requestStaffLink(rawEmail: string, returnTo?: string): Promise<void> {
  const email = normalizeEmail(rawEmail);
  if (!isStaffEmail(email)) return;
  const url = await issueLink(email, "staff", returnTo);
  if (!url) return;
  await sendMail({
    to: email,
    subject: "Admin sign-in link — Anthony Insurance applications",
    html: emailLayout({
      heading: "Sign in to the applications admin",
      paragraphs: [
        `Use the button below to sign in. This link works once and expires in ${TOKEN_TTL_MINUTES} minutes.`,
        "If you didn't request this, someone may have typed your address by mistake — you can ignore this email.",
      ],
      button: { label: "Sign in to admin", url },
    }),
  });
}

/** Spend a token. Returns its email, or null if invalid, expired, used, or for the other portal. */
export async function consumeMagicLink(token: string, purpose: LinkPurpose = "client"): Promise<string | null> {
  if (!/^[A-Za-z0-9_-]{30,100}$/.test(token)) return null;
  const db = await getDb();
  // Single atomic update so a token can't be used twice, even concurrently.
  const [row] = await db
    .update(loginTokens)
    .set({ usedAt: new Date() })
    .where(
      and(
        eq(loginTokens.tokenHash, hash(token)),
        eq(loginTokens.purpose, purpose),
        isNull(loginTokens.usedAt),
        gt(loginTokens.expiresAt, new Date()),
      ),
    )
    .returning({ email: loginTokens.email });
  if (!row) return null;
  // Staff status is re-checked at sign-in, so removing someone from STAFF_EMAILS
  // also kills any link they already have.
  if (purpose === "staff" && !isStaffEmail(row.email)) return null;
  return row.email;
}
