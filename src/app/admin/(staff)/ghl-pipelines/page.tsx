import { requireStaff } from "@/lib/auth/session";
import { GhlError, type GhlPipeline, ghlConfig, listPipelines } from "@/lib/ghl/client";
import { pipelineConfig, resolvePipeline } from "@/lib/ghl/sync";
import { STATUSES, STATUS_KEYS } from "@/lib/applications/status";

export const metadata = { title: "GHL pipelines | Anthony Insurance Services" };
// Always ask GHL live; never serve a copy rendered at build time.
export const dynamic = "force-dynamic";

/** Setup helper: shows the GHL pipeline and stage IDs to paste into Vercel. */
export default async function GhlPipelinesPage() {
  await requireStaff("/admin/ghl-pipelines");
  const raw = pipelineConfig();
  const token = (process.env.GHL_API_TOKEN ?? "").trim();

  // Fetch first, render after: JSX built inside try/catch wouldn't have its render errors caught.
  let pipelines: GhlPipeline[] = [];
  let errorStatus: number | null = null;
  let errorMessage = "";
  if (ghlConfig()) {
    try {
      pipelines = await listPipelines();
    } catch (err) {
      errorStatus = err instanceof GhlError ? err.status : 0;
      const body = err instanceof GhlError ? err.body : null;
      errorMessage =
        (body && typeof body === "object" && "message" in body ? String((body as { message: unknown }).message) : "") ||
        (err instanceof Error ? err.message : String(err));
    }
  }
  // Settings may be IDs or names; show what they resolve to (or why they don't).
  let configured: Awaited<ReturnType<typeof resolvePipeline>> = null;
  let configError: string | null = null;
  if (raw && errorStatus === null && ghlConfig()) {
    try {
      configured = await resolvePipeline();
    } catch (err) {
      configError = err instanceof Error ? err.message : String(err);
    }
  }

  let body: React.ReactNode;
  if (!ghlConfig()) {
    body = <p className="callout callout-notice">Add GHL_API_TOKEN and GHL_LOCATION_ID in Vercel first, then redeploy.</p>;
  } else if (errorStatus !== null) {
    body = (
      <div className="space-y-2 rounded-lg bg-[var(--danger-bg)] p-3 text-sm text-[var(--danger)]" role="alert">
        <p>
          GHL refused the request{errorStatus ? ` (${errorStatus})` : ""}: <strong>{errorMessage}</strong>
        </p>
        <p>
          {/authClass/i.test(errorMessage)
            ? "This token was created at the agency level. Create the Private Integration inside the Anthony Insurance sub-account (Settings → Private Integrations) and use that token."
            : errorStatus === 401
              ? "The token is invalid or was revoked. Create a new Private Integration in the sub-account and update GHL_API_TOKEN."
              : errorStatus === 403
                ? "The token is missing a scope (needs View/Edit Opportunities), or GHL_LOCATION_ID isn't the sub-account this token belongs to."
                : "Check GHL_API_TOKEN and GHL_LOCATION_ID in Vercel, then redeploy."}
        </p>
      </div>
    );
  } else {
    body = pipelines.length ? (
      <div className="space-y-6">
        {pipelines.map((p) => (
          <section key={p.id} className="card !p-5">
            <h2 className="font-semibold">{p.name}</h2>
            <p className="mb-3 text-sm">
              GHL_PIPELINE_ID = <code className="rounded bg-[var(--track)] px-1.5 py-0.5">{p.id}</code>
              {configured?.pipelineId === p.id && <span className="badge badge-success ml-2">in use</span>}
            </p>
            <table className="data-table">
              <thead>
                <tr>
                  <th>Stage</th>
                  <th>Stage ID</th>
                </tr>
              </thead>
              <tbody>
                {!p.stages?.length && (
                  <tr>
                    <td colSpan={2} className="text-[var(--muted)]">
                      GHL returned no stages for this pipeline. Add stages in GHL under Opportunities → Pipelines.
                    </td>
                  </tr>
                )}
                {(p.stages ?? []).map((s) => (
                  <tr key={s.id}>
                    <td>{s.name}</td>
                    <td>
                      <code className="text-xs">{s.id}</code>
                      {configured?.initialStage === s.id && <span className="badge badge-success ml-2">new applications</span>}
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </section>
        ))}
      </div>
    ) : (
      <p className="text-[var(--muted)]">No pipelines in this GHL sub-account yet. Create one under Opportunities → Pipelines.</p>
    );
}

  return (
    <div className="mx-auto max-w-3xl">
      <h1 className="text-2xl font-semibold">GHL pipelines</h1>
      <p className="mb-6 text-sm text-[var(--muted)]">
        Put the pipeline in <code>GHL_PIPELINE_ID</code> and the stage new applications should land in, into <code>GHL_PIPELINE_STAGE_ID</code>.
        Either the ID below or the name exactly as GHL shows it works (e.g. <code>Application Submitted</code>). To move opportunities when the
        status changes, set <code>GHL_STAGE_IDS</code> as JSON with these keys: {STATUS_KEYS.map((k) => `${k} (${STATUSES[k].label})`).join(", ")},
        e.g. <code>{`{"quoted":"Quote Sent","bound":"Won"}`}</code>.
      </p>
      <dl className="callout mb-6 grid grid-cols-[auto_1fr] gap-x-4 gap-y-1 text-sm">
        <dt className="font-medium">GHL_API_TOKEN</dt>
        <dd>{token ? `set (${token.startsWith("pit-") ? "Private Integration token" : "not a pit- token"}, ${token.length} characters)` : "missing"}</dd>
        <dt className="font-medium">GHL_LOCATION_ID</dt>
        <dd>{process.env.GHL_LOCATION_ID ? <code>{process.env.GHL_LOCATION_ID}</code> : "missing"}</dd>
        <dt className="font-medium">GHL_PIPELINE_ID</dt>
        <dd>{process.env.GHL_PIPELINE_ID ? <code>{process.env.GHL_PIPELINE_ID}</code> : "not set"}</dd>
        <dt className="font-medium">GHL_PIPELINE_STAGE_ID</dt>
        <dd>{process.env.GHL_PIPELINE_STAGE_ID ? <code>{process.env.GHL_PIPELINE_STAGE_ID}</code> : "not set"}</dd>
        <dt className="font-medium">GHL answered</dt>
        <dd>{!ghlConfig() ? "not called" : errorStatus !== null ? "with an error (below)" : `${pipelines.length} pipeline${pipelines.length === 1 ? "" : "s"}`}</dd>
      </dl>
      {configured && (
        <p className="callout mb-6 text-sm" role="status">
          Connected: new applications go to <strong>{configured.pipelineName}</strong>, stage{" "}
          <strong>{pipelines.flatMap((p) => p.stages ?? []).find((s) => s.id === configured.initialStage)?.name}</strong>.
        </p>
      )}
      {configError && (
        <p className="mb-6 rounded-lg bg-[var(--danger-bg)] p-3 text-sm text-[var(--danger)]" role="alert">
          {configError}
        </p>
      )}
      {body}
    </div>
  );
}
