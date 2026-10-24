import Link from "next/link";
import type { ReactNode } from "react";
import { requireStaff } from "@/lib/auth/session";
import { credentialStatus, type CredentialKey, type CredentialSource } from "@/lib/integrations/credentials";
import { testLeadAlchemist, testSalesforce, type Check } from "@/lib/integrations/test-connection";
import { getSettings } from "@/lib/settings";
import { clearIntegrationAction, saveIntegrationAction } from "./actions";

export const metadata = { title: "Integrations | Anthony Insurance Services" };
export const dynamic = "force-dynamic";

const SOURCE: Record<CredentialSource, { label: string; tone: string }> = {
  dashboard: { label: "Saved here", tone: "badge-success" },
  vercel: { label: "From Vercel", tone: "badge-active" },
  missing: { label: "Not set", tone: "badge-neutral" },
};

type Status = Awaited<ReturnType<typeof credentialStatus>>["status"];

function Field({
  id,
  label,
  hint,
  status,
  secret,
  placeholder,
}: {
  id: CredentialKey;
  label: string;
  hint: ReactNode;
  status: Status;
  secret?: boolean;
  placeholder?: string;
}) {
  const s = status[id];
  return (
    <div>
      <div className="flex flex-wrap items-center gap-2">
        <label className="field-label !mb-0" htmlFor={id}>{label}</label>
        <span className={`badge ${SOURCE[s.source].tone}`}>{SOURCE[s.source].label}</span>
        {s.savedBy && s.savedAt && (
          <span className="text-xs text-[var(--muted)]">
            by {s.savedBy.replace(/^staff:/, "")}, {new Date(s.savedAt).toLocaleDateString("en-US")}
          </span>
        )}
      </div>
      <input
        id={id}
        name={id}
        type={secret ? "password" : "text"}
        autoComplete="off"
        spellCheck={false}
        className="input mt-1"
        defaultValue={secret ? "" : (s.source === "dashboard" ? (s.value ?? "") : "")}
        placeholder={secret ? (s.source === "missing" ? placeholder : "•••••••• saved; type a new one to replace it") : (s.source === "vercel" ? (s.value ?? "") : placeholder)}
      />
      <p className="mt-1 text-xs text-[var(--muted)]">{hint}</p>
    </div>
  );
}

function Checks({ checks }: { checks: Check[] }) {
  return (
    <ul className="space-y-1 text-sm">
      {checks.map((c) => (
        <li key={c.label} className="flex gap-2">
          <span aria-hidden="true">{c.ok ? "✅" : "⚠️"}</span>
          <span>
            <strong>{c.label}:</strong> {c.detail}
          </span>
        </li>
      ))}
    </ul>
  );
}

function ClearForm({ integration }: { integration: string }) {
  return (
    <details className="mt-3 text-sm">
      <summary className="cursor-pointer text-[var(--muted)]">Remove the keys saved here</summary>
      <form action={clearIntegrationAction} className="mt-2 flex flex-wrap items-center gap-3">
        <input type="hidden" name="integration" value={integration} />
        <label className="flex items-center gap-2">
          <input type="checkbox" name="confirm" value="yes" required /> Remove them (any Vercel values apply again)
        </label>
        <button className="btn-secondary">Remove</button>
      </form>
    </details>
  );
}

export default async function Integrations({ searchParams }: PageProps<"/admin/settings/integrations">) {
  await requireStaff("/admin/settings/integrations");
  const sp = await searchParams;
  const one = (k: string) => (typeof sp[k] === "string" ? (sp[k] as string) : null);
  const { status, unreadable } = await credentialStatus();
  const settings = await getSettings();
  // Tests run when asked (?test=…), right after saving, so the page stays fast otherwise.
  const test = one("test");
  const [sfChecks, laChecks] = await Promise.all([
    test === "salesforce" || test === "all" ? testSalesforce() : Promise.resolve(null),
    test === "lead_alchemist" || test === "all" ? testLeadAlchemist() : Promise.resolve(null),
  ]);
  const sfSet = status.salesforceLoginUrl.source !== "missing" && status.salesforceClientId.source !== "missing" && status.salesforceClientSecret.source !== "missing";
  const laSet = status.laApiToken.source !== "missing" && status.laLocationId.source !== "missing";

  return (
    <div>
      <Link href="/admin/settings" className="btn-link">← Settings</Link>
      <h1 className="mb-2 mt-3 text-2xl font-semibold">Integrations</h1>
      <p className="mb-6 max-w-3xl text-sm text-[var(--muted)]">
        Connect Salesforce and Lead Alchemist. Keys saved here are encrypted, are never shown again, and take the place of the matching Vercel
        variables. Then manage what syncs in <Link className="btn-link" href="/admin/salesforce">Salesforce accounts</Link> and{" "}
        <Link className="btn-link" href="/admin/settings/mapping">Data mapping</Link>.
      </p>

      {one("error") && <p className="mb-4 rounded-lg bg-[var(--danger-bg)] p-3 text-sm text-[var(--danger)]" role="alert">{one("error")}</p>}
      {one("saved") && <p className="callout mb-4 text-sm" role="status">Saved. The connection test is below.</p>}
      {one("cleared") && <p className="callout mb-4 text-sm" role="status">Removed the saved keys.</p>}
      {unreadable && (
        <p className="mb-4 rounded-lg border border-[var(--notice-border)] bg-[var(--notice-bg)] p-3 text-sm" role="alert">
          The saved keys can&apos;t be read because INTEGRATIONS_KEY or SESSION_SECRET changed in Vercel. Enter them again.
        </p>
      )}

      <div className="grid gap-6 lg:grid-cols-2">
        {/* ── Salesforce ── */}
        <section className="card space-y-4 !p-5" aria-labelledby="sf">
          <div className="flex flex-wrap items-center justify-between gap-2">
            <h2 id="sf" className="font-semibold">Salesforce</h2>
            <span className={`badge ${sfSet ? "badge-success" : "badge-neutral"}`}>{sfSet ? "Keys set" : "Not connected"}</span>
          </div>
          <p className="text-sm text-[var(--muted)]">
            From the External Client App Anthony&apos;s Salesforce admin creates (docs/salesforce-setup.md, steps 2 and 3). The app signs in as the
            integration user and never deletes anything in Salesforce.
          </p>
          <form action={saveIntegrationAction} className="space-y-4">
            <input type="hidden" name="integration" value="salesforce" />
            <Field id="salesforceLoginUrl" label="My Domain URL" status={status} placeholder="https://anthony.my.salesforce.com" hint="Setup → My Domain. A sandbox looks like https://anthony--test.sandbox.my.salesforce.com." />
            <Field id="salesforceClientId" label="Consumer key" status={status} placeholder="3MVG9…" hint="External Client App → OAuth settings → Consumer Key and Secret." />
            <Field id="salesforceClientSecret" label="Consumer secret" status={status} secret placeholder="Paste the consumer secret" hint="Write-only: it's encrypted and never shown again." />
            <Field id="salesforceLightningUrl" label="Lightning URL (for links)" status={status} placeholder="https://anthony.lightning.force.com" hint="Open any record in Salesforce and copy the address up to .com." />
            <Field id="salesforceApiVersion" label="API version (optional)" status={status} placeholder="v62.0" hint="Leave blank for v62.0." />
            <div className="flex flex-wrap gap-2">
              <button className="btn-primary">Save and test</button>
              <Link className="btn-secondary" href="?test=salesforce#sf">Test connection</Link>
            </div>
          </form>
          {sfChecks && (
            <div className="border-t border-[var(--border)] pt-3">
              <h3 className="mb-2 text-sm font-semibold">Connection test</h3>
              <Checks checks={sfChecks} />
            </div>
          )}
          <p className="text-xs text-[var(--muted)]">
            Sync to Salesforce: <strong>{settings.salesforceEnabled ? (settings.salesforceDryRun ? "on, dry run" : "on, live") : "off"}</strong> (
            <Link className="btn-link" href="/admin/settings#salesforce">change</Link>).
          </p>
          <ClearForm integration="salesforce" />
        </section>

        {/* ── Lead Alchemist ── */}
        <section className="card space-y-4 !p-5" aria-labelledby="la">
          <div className="flex flex-wrap items-center justify-between gap-2">
            <h2 id="la" className="font-semibold">Lead Alchemist</h2>
            <span className={`badge ${laSet ? "badge-success" : "badge-neutral"}`}>{laSet ? "Keys set" : "Not connected"}</span>
          </div>
          <p className="text-sm text-[var(--muted)]">
            A Private Integration token from the Anthony Insurance sub-account (Settings → Private Integrations), with these scopes: View/Edit
            Contacts, View/Edit Custom Fields, View/Edit Opportunities and Businesses (view, edit) for Companies.
          </p>
          <form action={saveIntegrationAction} className="space-y-4">
            <input type="hidden" name="integration" value="lead_alchemist" />
            <Field id="laApiToken" label="Private Integration token" status={status} secret placeholder="pit-…" hint="Write-only: it's encrypted and never shown again." />
            <Field id="laLocationId" label="Location (sub-account) ID" status={status} placeholder="e.g. AbC123dEf456GhI789" hint="The letters and numbers after /location/ in the Lead Alchemist address." />
            <div className="flex flex-wrap gap-2">
              <button className="btn-primary">Save and test</button>
              <Link className="btn-secondary" href="?test=lead_alchemist#la">Test connection</Link>
            </div>
          </form>
          {laChecks && (
            <div className="border-t border-[var(--border)] pt-3">
              <h3 className="mb-2 text-sm font-semibold">Connection test</h3>
              <Checks checks={laChecks} />
            </div>
          )}
          <p className="text-xs text-[var(--muted)]">
            Links open <code>{settings.ghlAppUrl || "https://app.leadalchemist.io"}</code>. Pipelines and stages:{" "}
            <Link className="btn-link" href="/admin/lead-alchemist">Lead Alchemist setup</Link>.
          </p>
          <ClearForm integration="lead_alchemist" />
        </section>
      </div>
    </div>
  );
}
