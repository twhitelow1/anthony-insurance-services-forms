import { sql } from "drizzle-orm";
import { getDb } from "@/lib/db";
import { databaseUrl, describeDbError } from "@/lib/db/url";
import { openAccess } from "@/lib/auth/session";
import { mailConfigured } from "@/lib/mail";
import { getSettings } from "@/lib/settings";
import { ghlConfig } from "@/lib/ghl/client";
import { access } from "node:fs/promises";
import { desc } from "drizzle-orm";
import { schema } from "@/lib/db";
import { carrierFormFor, templatePath } from "@/lib/pdf/carrier";
import { sportsFacilityApplication } from "@/forms/sports-facility-application";

export const dynamic = "force-dynamic";
export const metadata = { title: "Status | Anthony Insurance Services" };

async function checkDatabase() {
  const found = databaseUrl();
  if (!found) return { ok: false, detail: "No database setting found. Add DATABASE_URL (Vercel → Storage → connect Neon to this project)." };
  try {
    const db = await getDb();
    const rows = await db.execute(sql`select count(*)::int as n from applications`);
    const n = (rows as unknown as { rows: { n: number }[] }).rows?.[0]?.n ?? 0;
    return { ok: true, detail: `Connected using ${found.name}. Tables are set up. ${n} application(s) stored.` };
  } catch (err) {
    return { ok: false, detail: `Found ${found.name} but couldn't use it: ${describeDbError(err)}` };
  }
}

async function checkPdfTemplate() {
  const spec = carrierFormFor(sportsFacilityApplication.slug);
  if (!spec) return { ok: false, detail: "No carrier form is mapped for this form." };
  try {
    await access(templatePath(spec.template));
    return { ok: true, detail: `Carrier PDF template ${spec.template} is on the server.` };
  } catch {
    return { ok: false, detail: `Carrier PDF template ${spec.template} is missing from the server bundle, so PDFs can't be created.` };
  }
}

async function checkStoredPdfs() {
  try {
    const db = await getDb();
    const { applicationDocuments: d, applicationEvents: e } = schema;
    const [latest] = await db.select().from(d).orderBy(desc(d.createdAt)).limit(1);
    const [failure] = await db
      .select({ message: e.message, at: e.createdAt })
      .from(e)
      .where(sql`${e.type} = 'pdf_failed'`)
      .orderBy(desc(e.createdAt))
      .limit(1);
    const lastError = failure ? ` Last PDF error (${failure.at.toISOString().slice(0, 16)} UTC): ${failure.message}` : "";
    if (!latest) return { ok: false, detail: `No PDFs stored yet. Submit a test application.${lastError}` };
    const bytes = latest.content;
    const valid = bytes.length === latest.size && bytes.subarray(0, 5).toString("latin1") === "%PDF-";
    return valid
      ? { ok: true, detail: `Latest PDF (${latest.kind}, ${Math.round(latest.size / 1024)} KB) reads back correctly.${lastError}` }
      : {
          ok: false,
          detail: `Latest PDF reads back damaged: stored ${latest.size} bytes, read ${bytes.length}, starts with ${JSON.stringify(bytes.subarray(0, 8).toString("latin1"))}.${lastError}`,
        };
  } catch (err) {
    return { ok: false, detail: `Couldn't check stored PDFs: ${describeDbError(err)}` };
  }
}

/** Public setup checklist: which settings are present (never their values) and whether the database works. */
export default async function Status() {
  const [db, template, pdfs, settings] = await Promise.all([checkDatabase(), checkPdfTemplate(), checkStoredPdfs(), getSettings()]);
  const rows: { name: string; ok: boolean; detail: string; required?: boolean }[] = [
    { name: "Database", required: true, ...db },
    { name: "Carrier PDF template", required: true, ...template },
    { name: "Stored PDFs", required: true, ...pdfs },
    {
      name: "Sign-in",
      ok: openAccess() || (process.env.SESSION_SECRET?.length ?? 0) >= 32,
      required: true,
      detail: openAccess()
        ? "Testing mode (OPEN_ACCESS) is on: sign-in is off. Everyone can see every application."
        : (process.env.SESSION_SECRET?.length ?? 0) >= 32
          ? "SESSION_SECRET is set."
          : process.env.OPEN_ACCESS !== undefined
            ? `OPEN_ACCESS is set, but to a value this app doesn't recognise (${JSON.stringify(process.env.OPEN_ACCESS.slice(0, 20))}). Change it to 1 and redeploy.`
            : `This deployment doesn't see OPEN_ACCESS or SESSION_SECRET. Add OPEN_ACCESS = 1 for the ${process.env.VERCEL_ENV ?? "current"} environment in Vercel, then redeploy.`,
    },
    {
      name: "Site address",
      ok: !!process.env.APP_URL,
      detail: process.env.APP_URL ? `APP_URL = ${process.env.APP_URL}` : "APP_URL not set. Links in emails and Lead Alchemist need it.",
    },
    {
      name: "Email",
      ok: mailConfigured(),
      detail: mailConfigured() ? `Email sending is set up. Sender: ${settings.mailFrom}` : "Not set up yet (RESEND_API_KEY in Vercel).",
    },
    { name: "Lead Alchemist", ok: !!ghlConfig(), detail: ghlConfig() ? "Lead Alchemist token and location are set." : "Not set up yet (GHL_API_TOKEN and GHL_LOCATION_ID)." },
    { name: "Claude AI review", ok: !!process.env.ANTHROPIC_API_KEY, detail: process.env.ANTHROPIC_API_KEY ? "Set up." : "Optional. Not set up (ANTHROPIC_API_KEY)." },
  ];
  const ready = rows.filter((r) => r.required).every((r) => r.ok);

  return (
    <main className="mx-auto w-full max-w-2xl px-4 py-12">
      <p className="mb-2 text-sm font-semibold uppercase tracking-[0.18em] text-[var(--accent-strong)]">Anthony Insurance Services</p>
      <h1 className="mb-2 text-2xl font-semibold">Setup status</h1>
      <p className="mb-6 text-[var(--muted)]">
        {ready ? "The form can take submissions." : "Something required is missing, so submissions will fail until it's fixed."}
      </p>
      <ul className="card divide-y divide-[var(--border)] !p-0">
        {rows.map((r) => (
          <li key={r.name} className="flex gap-3 p-4">
            <span aria-hidden="true" className={r.ok ? "text-[var(--success)]" : r.required ? "text-[var(--danger)]" : "text-[var(--muted)]"}>
              {r.ok ? "✓" : r.required ? "✗" : "–"}
            </span>
            <div>
              <p className="font-medium">
                {r.name}
                {r.required && !r.ok && <span className="ml-2 text-xs font-semibold text-[var(--danger)]">REQUIRED</span>}
              </p>
              <p className="text-sm text-[var(--muted)]">{r.detail}</p>
            </div>
          </li>
        ))}
      </ul>
      <p className="mt-4 text-xs text-[var(--muted)]">After changing a setting in Vercel, redeploy for it to take effect.</p>
    </main>
  );
}
