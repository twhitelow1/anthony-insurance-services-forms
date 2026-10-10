import { after, type NextRequest } from "next/server";
import { getForm } from "@/forms";
import type { FormValues } from "@/lib/forms/types";
import { decodeRef, encodeRef, getDraft, saveDraft } from "@/lib/applications/drafts";
import { syncDraftStarted } from "@/lib/applications/pipeline";

const MAX_BODY_BYTES = 300_000;

function sanitize(input: unknown): FormValues {
  const out: FormValues = {};
  if (!input || typeof input !== "object") return out;
  for (const [k, v] of Object.entries(input as Record<string, unknown>)) {
    if (k === "signature") continue; // never stored with a draft
    if (typeof v === "string") out[k] = v.slice(0, 5_000);
    else if (Array.isArray(v)) out[k] = v.filter((x): x is string => typeof x === "string").slice(0, 50);
  }
  return out;
}

/** Save progress: { ref?, values, step } → { ref }. */
export async function POST(req: NextRequest, ctx: RouteContext<"/api/forms/[slug]/draft">) {
  const { slug } = await ctx.params;
  const form = getForm(slug);
  if (!form) return Response.json({ error: "Form not found" }, { status: 404 });
  const raw = await req.text();
  if (raw.length > MAX_BODY_BYTES) return Response.json({ error: "Too large" }, { status: 413 });
  let body: { ref?: unknown; values?: unknown; step?: unknown; website_hp?: string };
  try {
    body = JSON.parse(raw);
  } catch {
    return Response.json({ error: "Invalid JSON" }, { status: 400 });
  }
  if (body.website_hp) return Response.json({ ok: true });

  const saved = await saveDraft(form, { ref: decodeRef(body.ref), values: sanitize(body.values), step: Number(body.step) || 0 });
  if (!saved) return Response.json({ error: "This application was already submitted." }, { status: 409 });
  // Once there's an email, Lead Alchemist gets the contact tagged "app-started" (after the response).
  if (saved.emailChanged) after(() => syncDraftStarted(form, saved.draft));
  return Response.json({ ok: true, ref: encodeRef(saved.ref) });
}

/** Resume: ?resume=<ref> → { values, step }. */
export async function GET(req: NextRequest, ctx: RouteContext<"/api/forms/[slug]/draft">) {
  const { slug } = await ctx.params;
  const ref = decodeRef(req.nextUrl.searchParams.get("resume"));
  const draft = ref && (await getDraft(ref));
  if (!draft || draft.formSlug !== slug) return Response.json({ error: "This link isn't valid." }, { status: 404 });
  if (draft.status !== "started") return Response.json({ error: "This application was already submitted." }, { status: 409 });
  return Response.json({ ok: true, values: draft.values, step: draft.step }, { headers: { "Cache-Control": "no-store" } });
}
