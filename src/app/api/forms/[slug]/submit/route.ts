import { after, type NextRequest } from "next/server";
import { getForm } from "@/forms";
import { pruneValues, validateForm } from "@/lib/forms/validate";
import type { FormValues } from "@/lib/forms/types";
import { createApplication } from "@/lib/applications/repo";
import { onApplicationSubmitted } from "@/lib/applications/pipeline";
import { receiptPath } from "@/lib/applications/receipt";
import { openAccess } from "@/lib/auth/session";
import { describeDbError } from "@/lib/db/url";

export const maxDuration = 60;

const MAX_BODY_BYTES = 1_000_000;

// Best-effort per-instance throttle. For hard limits, add a Vercel Firewall rate-limit rule on this path.
const recent = new Map<string, number[]>();
function throttled(ip: string) {
  const now = Date.now();
  const hits = (recent.get(ip) ?? []).filter((t) => now - t < 60_000);
  hits.push(now);
  recent.set(ip, hits);
  return hits.length > 5;
}

function sanitize(input: unknown): FormValues {
  const out: FormValues = {};
  if (!input || typeof input !== "object") return out;
  for (const [k, v] of Object.entries(input as Record<string, unknown>)) {
    if (typeof v === "string") out[k] = v.slice(0, k === "signature" ? 500_000 : 5_000);
    else if (Array.isArray(v)) out[k] = v.filter((x): x is string => typeof x === "string").slice(0, 50);
  }
  return out;
}

export async function POST(req: NextRequest, ctx: RouteContext<"/api/forms/[slug]/submit">) {
  const { slug } = await ctx.params;
  const form = getForm(slug);
  if (!form) return Response.json({ error: "Form not found" }, { status: 404 });

  const ip = req.headers.get("x-forwarded-for")?.split(",")[0]?.trim() ?? "unknown";
  if (throttled(ip)) return Response.json({ error: "Too many submissions. Please wait a minute." }, { status: 429 });

  const raw = await req.text();
  if (raw.length > MAX_BODY_BYTES) return Response.json({ error: "Submission too large" }, { status: 413 });

  let body: { values?: unknown; website_hp?: string };
  try {
    body = JSON.parse(raw);
  } catch {
    return Response.json({ error: "Invalid JSON" }, { status: 400 });
  }

  // Honeypot: real users never see this field. Pretend success so bots move on.
  if (body.website_hp) return Response.json({ ok: true, reference: "AIS-0000-0000" });

  const values = pruneValues(form, sanitize(body.values));
  const errors = validateForm(form, values);
  if (Object.keys(errors).length) return Response.json({ error: "Validation failed", errors }, { status: 422 });

  let app;
  try {
    // The database is the system of record — once this succeeds, nothing is lost.
    app = await createApplication(form, values, { ip, userAgent: req.headers.get("user-agent") ?? undefined });
  } catch (err) {
    console.error("[submit] could not save application", err);
    // In testing mode, say why, so setup problems are visible (see /status).
    const detail = openAccess() ? ` (Testing detail: ${describeDbError(err)}. Check /status.)` : "";
    return Response.json(
      { error: `We couldn't submit your application right now. Please try again, or call our office.${detail}` },
      { status: 500 },
    );
  }

  // Lead Alchemist sync + confirmation email run after the response; failures are logged
  // on the application's timeline and can be retried from the admin page.
  after(() => onApplicationSubmitted(form, app));

  // The application is saved; a missing SESSION_SECRET only costs the "view a copy" button.
  const pdfUrl = await receiptPath(app.id).catch((err) => {
    console.error("[submit] could not create the receipt link", err);
    return undefined;
  });
  return Response.json({ ok: true, reference: app.reference, pdfUrl });
}
