import "server-only";
import { createHash, randomBytes } from "node:crypto";
import { and, count, eq, gt, isNull } from "drizzle-orm";
import { getDb, schema } from "@/lib/db";
import { hasApplications, normalizeEmail } from "@/lib/applications/repo";
import { emailLayout, sendMail } from "@/lib/mail/graph";

const { loginTokens } = schema;
const TOKEN_TTL_MINUTES = 20;
const MAX_LINKS_PER_15_MIN = 3;

const hash = (token: string) => createHash("sha256").update(token).digest("hex");
const appUrl = () => (process.env.APP_URL ?? "http://localhost:3000").replace(/\/$/, "");

/**
 * Email a one-time sign-in link — but only if this email has applications.
 * Callers always show the same "check your email" message, so the response
 * never reveals whether an email is on file.
 */
export async function requestMagicLink(rawEmail: string): Promise<void> {
  const email = normalizeEmail(rawEmail);
  if (!/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(email) || !(await hasApplications(email))) return;

  const db = await getDb();
  const [{ n }] = await db
    .select({ n: count() })
    .from(loginTokens)
    .where(and(eq(loginTokens.email, email), gt(loginTokens.createdAt, new Date(Date.now() - 15 * 60_000))));
  if (n >= MAX_LINKS_PER_15_MIN) return;

  const token = randomBytes(32).toString("base64url");
  await db.insert(loginTokens).values({
    tokenHash: hash(token),
    email,
    expiresAt: new Date(Date.now() + TOKEN_TTL_MINUTES * 60_000),
  });

  // The link opens a confirmation page; the token is only spent when the person
  // clicks "Sign in". Email security scanners (e.g. Microsoft Safe Links) that
  // pre-open links therefore can't burn it.
  await sendMail({
    to: email,
    subject: "Your sign-in link — Anthony Insurance Services",
    html: emailLayout({
      heading: "Sign in to check your application",
      paragraphs: [
        `Use the button below to sign in. This link works once and expires in ${TOKEN_TTL_MINUTES} minutes.`,
        "If you didn't request this, you can ignore this email.",
      ],
      button: { label: "Sign in", url: `${appUrl()}/portal/verify?token=${token}` },
    }),
  });
}

/** Spend a token. Returns the email it was issued to, or null if invalid/expired/used. */
export async function consumeMagicLink(token: string): Promise<string | null> {
  if (!/^[A-Za-z0-9_-]{30,100}$/.test(token)) return null;
  const db = await getDb();
  // Single atomic update so a token can't be used twice, even concurrently.
  const [row] = await db
    .update(loginTokens)
    .set({ usedAt: new Date() })
    .where(and(eq(loginTokens.tokenHash, hash(token)), isNull(loginTokens.usedAt), gt(loginTokens.expiresAt, new Date())))
    .returning({ email: loginTokens.email });
  return row?.email ?? null;
}
