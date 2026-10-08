import { requireStaff } from "@/lib/auth/session";
import { STATUSES, STATUS_KEYS } from "@/lib/applications/status";
import { type GhlPipeline, ghlConfig, listPipelines } from "@/lib/ghl/client";
import { resendConfigured } from "@/lib/mail/resend";
import { envSettings, storedSettings } from "@/lib/settings";
import { saveSettingsAction, sendTestEmailAction } from "./actions";

export const metadata = { title: "Settings | Anthony Insurance Services" };

const lines = (v: string[] | undefined) => (v ?? []).join("\n");

function Hint({ children }: { children: React.ReactNode }) {
  return <p className="mt-1 text-xs text-[var(--muted)]">{children}</p>;
}

/** "Using the Vercel value" note under a field that isn't saved here. */
function FromVercel({ value, saved }: { value: string; saved: boolean }) {
  if (saved) return null;
  return <Hint>{value ? <>Not saved here, so the Vercel value is used: <code>{value}</code></> : "Not set."}</Hint>;
}

export default async function SettingsPage({ searchParams }: PageProps<"/admin/settings">) {
  await requireStaff("/admin/settings");
  const sp = await searchParams;
  const env = envSettings();
  const saved = await storedSettings();

  let pipelines: GhlPipeline[] = [];
  let ghlError = "";
  if (ghlConfig()) {
    try {
      pipelines = await listPipelines();
    } catch (err) {
      ghlError = err instanceof Error ? err.message : String(err);
    }
  }
  const stageOptions = (pipelineFilter?: (p: GhlPipeline) => boolean) =>
    pipelines.filter(pipelineFilter ?? (() => true)).map((p) => (
      <optgroup key={p.id} label={p.name}>
        {(p.stages ?? []).map((s) => (
          <option key={s.id} value={s.id}>
            {s.name}
          </option>
        ))}
      </optgroup>
    ));
  // A saved value that GHL doesn't list (a name, or a deleted stage) still shows, so saving doesn't drop it.
  const keep = (value: string | undefined, ids: string[]) =>
    value && !ids.includes(value) ? <option value={value}>{value} (saved)</option> : null;
  const pipelineIds = pipelines.map((p) => p.id);
  const stageIds = pipelines.flatMap((p) => (p.stages ?? []).map((s) => s.id));
  const vercel = (v: string) => (v ? `Use Vercel value (${v})` : "Not set");

  return (
    <div className="mx-auto max-w-3xl">
      <h1 className="text-2xl font-semibold">Settings</h1>
      <p className="mb-6 text-sm text-[var(--muted)]">
        Changes apply right away, no redeploy needed. Anything left blank uses its Vercel environment variable. API keys and other
        secrets stay in Vercel.
      </p>
      {sp.saved && <p className="callout mb-4 text-sm" role="status">Settings saved.</p>}
      {typeof sp.sent === "string" && <p className="callout mb-4 text-sm" role="status">Test email sent to {sp.sent}. Check that inbox (and spam).</p>}
      {typeof sp.error === "string" && (
        <p className="mb-4 rounded-lg bg-[var(--danger-bg)] p-3 text-sm text-[var(--danger)]" role="alert">{sp.error}</p>
      )}

      <form action={saveSettingsAction} className="space-y-6">
        <section className="card !p-5" aria-labelledby="admins">
          <h2 id="admins" className="mb-3 font-semibold">Admins</h2>
          <label className="field-label" htmlFor="staffEmails">Who can sign in to admin (one email per line)</label>
          <textarea id="staffEmails" name="staffEmails" rows={4} className="input" defaultValue={lines(saved.staffEmails)} placeholder="melanie@anthonyinsuranceservices.com" />
          {env.staffEmails.length > 0 && (
            <Hint>Always admins (STAFF_EMAILS in Vercel): {env.staffEmails.join(", ")}</Hint>
          )}
          <Hint>Removing someone signs them out right away. You can&apos;t remove yourself.</Hint>
          <label className="field-label mt-4" htmlFor="staffEmailDomains">Staff email domains</label>
          <input id="staffEmailDomains" name="staffEmailDomains" className="input" defaultValue={(saved.staffEmailDomains ?? []).join(", ")} placeholder={env.staffEmailDomains.join(", ")} />
          <Hint>Only used while no admins are listed: then anyone with an email at these domains can sign in.</Hint>
        </section>

        <section className="card !p-5" aria-labelledby="notifications">
          <h2 id="notifications" className="mb-3 font-semibold">Notifications</h2>
          <label className="field-label" htmlFor="notifyEmails">Email these people about every new application (one per line)</label>
          <textarea id="notifyEmails" name="notifyEmails" rows={3} className="input" defaultValue={lines(saved.notifyEmails)} />
          <FromVercel value={env.notifyEmails.join(", ")} saved={!!saved.notifyEmails} />
        </section>

        <section className="card !p-5" aria-labelledby="email">
          <h2 id="email" className="mb-3 font-semibold">Email sender</h2>
          <p className="mb-3 text-sm">
            Resend: {resendConfigured() ? <span className="badge badge-success">connected</span> : <span className="badge">RESEND_API_KEY missing in Vercel</span>}
          </p>
          <label className="field-label" htmlFor="mailFrom">Send from</label>
          <input id="mailFrom" name="mailFrom" className="input" defaultValue={saved.mailFrom ?? ""} placeholder={env.mailFrom} />
          <Hint>Name and address, e.g. Anthony Insurance Services &lt;applications@anthonyinsuranceservices.com&gt;. The domain must be verified in Resend.</Hint>
          <FromVercel value={env.mailFrom} saved={!!saved.mailFrom} />
          <label className="field-label mt-4" htmlFor="mailReplyTo">Replies go to</label>
          <input id="mailReplyTo" name="mailReplyTo" type="email" className="input" defaultValue={saved.mailReplyTo ?? ""} placeholder={env.mailReplyTo || "melanie@anthonyinsuranceservices.com"} />
          <FromVercel value={env.mailReplyTo} saved={!!saved.mailReplyTo} />
        </section>

        <section className="card !p-5" aria-labelledby="carrier">
          <h2 id="carrier" className="mb-3 font-semibold">Carrier submissions</h2>
          <label className="field-label" htmlFor="carrierEmails">Carrier email (pre-filled on the &quot;email to carrier&quot; draft)</label>
          <textarea id="carrierEmails" name="carrierEmails" rows={2} className="input" defaultValue={lines(saved.carrierEmails)} />
          <FromVercel value={env.carrierEmails.join(", ")} saved={!!saved.carrierEmails} />
        </section>

        <section className="card !p-5" aria-labelledby="ghl">
          <h2 id="ghl" className="mb-1 font-semibold">GoHighLevel pipeline</h2>
          {!ghlConfig() ? (
            <p className="text-sm text-[var(--muted)]">Connect GHL first: add GHL_API_TOKEN and GHL_LOCATION_ID in Vercel.</p>
          ) : ghlError ? (
            <p className="text-sm text-[var(--danger)]">GHL didn&apos;t return pipelines: {ghlError}. See GHL setup.</p>
          ) : null}
          <p className="mb-3 text-sm text-[var(--muted)]">Every application becomes its own opportunity in this pipeline.</p>
          <div className="grid gap-4 sm:grid-cols-2">
            <div>
              <label className="field-label" htmlFor="ghlPipeline">Applications pipeline</label>
              <select id="ghlPipeline" name="ghlPipeline" className="input" defaultValue={saved.ghlPipeline ?? ""}>
                <option value="">{vercel(env.ghlPipeline)}</option>
                {keep(saved.ghlPipeline, pipelineIds)}
                {pipelines.map((p) => (
                  <option key={p.id} value={p.id}>{p.name}</option>
                ))}
              </select>
            </div>
            <div>
              <label className="field-label" htmlFor="ghlPipelineStage">Stage for new applications</label>
              <select id="ghlPipelineStage" name="ghlPipelineStage" className="input" defaultValue={saved.ghlPipelineStage ?? ""}>
                <option value="">{vercel(env.ghlPipelineStage)}</option>
                {keep(saved.ghlPipelineStage, stageIds)}
                {stageOptions()}
              </select>
            </div>
            <div>
              <label className="field-label" htmlFor="ghlLeadPipeline">Lead pipeline (moved over when they apply)</label>
              <select id="ghlLeadPipeline" name="ghlLeadPipeline" className="input" defaultValue={saved.ghlLeadPipeline ?? ""}>
                <option value="">{env.ghlLeadPipeline ? vercel(env.ghlLeadPipeline) : "Don't move leads"}</option>
                {keep(saved.ghlLeadPipeline, pipelineIds)}
                {pipelines.map((p) => (
                  <option key={p.id} value={p.id}>{p.name}</option>
                ))}
              </select>
            </div>
            <div>
              <label className="field-label" htmlFor="ghlLeadStage">Lead stage (optional)</label>
              <select id="ghlLeadStage" name="ghlLeadStage" className="input" defaultValue={saved.ghlLeadStage ?? ""}>
                <option value="">{env.ghlLeadStage ? vercel(env.ghlLeadStage) : "Any stage in the lead pipeline"}</option>
                {keep(saved.ghlLeadStage, stageIds)}
                {stageOptions()}
              </select>
            </div>
          </div>
          <h3 className="mb-2 mt-5 text-sm font-semibold">Move the opportunity when the status changes (optional)</h3>
          <div className="grid gap-3 sm:grid-cols-2">
            {STATUS_KEYS.map((k) => {
              const value = saved.ghlStageMap?.[k] ?? "";
              return (
                <div key={k}>
                  <label className="field-label" htmlFor={`stage_${k}`}>{STATUSES[k].label}</label>
                  <select id={`stage_${k}`} name={`stage_${k}`} className="input" defaultValue={value}>
                    <option value="">{env.ghlStageMap[k] && !saved.ghlStageMap ? vercel(env.ghlStageMap[k]!) : "Don't move"}</option>
                    {keep(value, stageIds)}
                    {stageOptions()}
                  </select>
                </div>
              );
            })}
          </div>
          <Hint>Pick stages from the applications pipeline. Bound, declined and withdrawn also mark the opportunity won, lost or abandoned.</Hint>
        </section>

        <button className="btn-primary">Save settings</button>
      </form>

      <form action={sendTestEmailAction} className="mt-6">
        <button className="btn-secondary" disabled={!resendConfigured()}>Send me a test email</button>
        <Hint>Uses the saved sender settings. Save first if you changed them.</Hint>
      </form>
    </div>
  );
}
