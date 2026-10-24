import "server-only";
import { randomBytes } from "node:crypto";
import { cookies } from "next/headers";

/**
 * One-time result messages after an admin action, kept out of URLs (they can name people).
 * The action stores the message under a random id and redirects with ?f=<id>; the page shows
 * it only when the id matches, so it doesn't reappear on later visits.
 */
const COOKIE = "ais_flash";

export interface Flash {
  /** "warn": it ran, but something needs attention (a sync with conflicts or errors). */
  tone: "ok" | "warn" | "error";
  text: string;
  /** An admin page with the details, e.g. the sync report. */
  href?: string;
}

/** For server actions: store the message and return the ?f= value for the redirect. */
export async function setFlash(flash: Flash): Promise<string> {
  const id = randomBytes(6).toString("hex");
  (await cookies()).set(COOKIE, JSON.stringify({ id, ...flash, text: flash.text.slice(0, 500) }), {
    httpOnly: true,
    secure: process.env.NODE_ENV === "production",
    sameSite: "lax",
    path: "/admin",
    maxAge: 120,
  });
  return id;
}

/** For pages: the message for this ?f= id, if any. */
export async function readFlash(id: string | string[] | undefined): Promise<Flash | null> {
  if (typeof id !== "string" || !id) return null;
  try {
    const raw = (await cookies()).get(COOKIE)?.value;
    const v = raw ? (JSON.parse(raw) as Flash & { id: string }) : null;
    if (!v || v.id !== id || !["ok", "warn", "error"].includes(v.tone)) return null;
    const href = typeof v.href === "string" && v.href.startsWith("/admin/") && !v.href.includes("//") ? v.href : undefined;
    return { tone: v.tone, text: String(v.text), ...(href ? { href } : {}) };
  } catch {
    return null;
  }
}
