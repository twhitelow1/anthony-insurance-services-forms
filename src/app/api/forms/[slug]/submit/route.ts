import type { NextRequest } from "next/server";
import { getForm } from "@/forms";
import { applyOptionOverrides, pruneValues, validateForm } from "@/lib/forms/validate";
import type { FormValues } from "@/lib/forms/types";
import {
  GhlError,
  addContactNote,
  ghlConfig,
  listCustomFields,
  uploadCustomFieldFile,
  upsertContact,
} from "@/lib/ghl/client";
import { buildContactPayload, ghlOptionOverrides, submissionNote } from "@/lib/ghl/mapping";

export const maxDuration = 30;

const MAX_BODY_BYTES = 1_000_000;

// Best-effort per-instance throttle. For hard limits, add Vercel Firewall rate limiting on this path.
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
  const baseForm = getForm(slug);
  if (!baseForm) return Response.json({ error: "Form not found" }, { status: 404 });

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
  if (body.website_hp) return Response.json({ ok: true });

  if (!ghlConfig()) {
    const values = pruneValues(baseForm, sanitize(body.values));
    const errors = validateForm(baseForm, values);
    if (Object.keys(errors).length) return Response.json({ error: "Validation failed", errors }, { status: 422 });
    if (process.env.NODE_ENV !== "production") {
      console.warn("[submit] GHL not configured — dry run. Values:", { ...values, signature: values.signature ? "<png>" : undefined });
      return Response.json({ ok: true, dryRun: true });
    }
    return Response.json({ error: "Form is not configured. Please call our office." }, { status: 503 });
  }

  try {
    // Validate against the same GHL-synced dropdown options the browser was shown.
    const customFields = await listCustomFields();
    const form = applyOptionOverrides(baseForm, ghlOptionOverrides(baseForm, customFields));
    const values = pruneValues(form, sanitize(body.values));
    const errors = validateForm(form, values);
    if (Object.keys(errors).length) return Response.json({ error: "Validation failed", errors }, { status: 422 });

    const { contact, signature, unmapped } = buildContactPayload(form, values, customFields);
    const { contact: saved } = await upsertContact(contact);

    // Secondary writes: failures here shouldn't fail the submission — the contact
    // and all mapped fields are already saved.
    const followUps: Promise<unknown>[] = [];

    if (signature) {
      const png = Buffer.from(signature.dataUrl.split(",")[1], "base64");
      followUps.push(
        uploadCustomFieldFile(saved.id, signature.fieldId, new Blob([png], { type: "image/png" }), "signature.png"),
      );
    }

    let note = submissionNote(form, values, {
      Submitted: new Date().toISOString(),
      "IP address": ip,
      "User agent": req.headers.get("user-agent") ?? "unknown",
      Signed: values.signature ? "Yes (electronic signature captured)" : "No",
    });
    if (unmapped.length) {
      note += `\n⚠️ ${unmapped.length} answer(s) had no matching GHL custom field (see list above).`;
    }
    followUps.push(addContactNote(saved.id, note));

    const results = await Promise.allSettled(followUps);
    for (const r of results) if (r.status === "rejected") console.error("[submit] follow-up failed", describe(r.reason));

    return Response.json({ ok: true });
  } catch (err) {
    console.error("[submit] GHL error", describe(err));
    return Response.json(
      { error: "We couldn't submit your application right now. Please try again, or call our office." },
      { status: 502 },
    );
  }
}

const describe = (err: unknown) =>
  err instanceof GhlError ? { message: err.message, status: err.status, body: err.body } : err;
