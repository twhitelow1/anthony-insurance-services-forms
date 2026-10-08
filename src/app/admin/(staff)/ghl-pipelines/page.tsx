import { requireStaff } from "@/lib/auth/session";
import { GhlError, type GhlPipeline, ghlConfig, listPipelines } from "@/lib/ghl/client";
import { pipelineConfig, resolvePipeline } from "@/lib/ghl/sync";
import Link from "next/link";

export const metadata = { title: "GHL pipelines | Anthony Insurance Services" };
// Always ask GHL live; never serve a copy rendered at build time.
export const dynamic = "force-dynamic";

/** Setup helper: shows the GHL connection, its pipelines and stages, and what the settings resolve to. */
export default async function GhlPipelinesPage() {
  await requireStaff("/admin/ghl-pipelines");
  const raw = await pipelineConfig();
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
        Choose the pipeline, stages and lead pipeline in{" "}
        <Link className="btn-link" href="/admin/settings#ghl">Settings</Link>. This page shows the connection and every pipeline and stage
        GHL returns. To store the reference, link and PDF on each opportunity, create opportunity custom fields named Application
        Reference, Application Status, Application Link and Application PDF.
      </p>
      <dl className="callout mb-6 grid grid-cols-[auto_1fr] gap-x-4 gap-y-1 text-sm">
        <dt className="font-medium">GHL_API_TOKEN</dt>
        <dd>{token ? `set (${token.startsWith("pit-") ? "Private Integration token" : "not a pit- token"}, ${token.length} characters)` : "missing"}</dd>
        <dt className="font-medium">GHL_LOCATION_ID</dt>
        <dd>{process.env.GHL_LOCATION_ID ? <code>{process.env.GHL_LOCATION_ID}</code> : "missing"}</dd>
        <dt className="font-medium">Pipeline</dt>
        <dd>{raw?.pipelineId ? <code>{raw.pipelineId}</code> : "not set (no opportunities are created)"}</dd>
        <dt className="font-medium">Stage for new applications</dt>
        <dd>{raw?.initialStage ? <code>{raw.initialStage}</code> : "not set"}</dd>
        <dt className="font-medium">Lead pipeline</dt>
        <dd>{raw?.leadPipeline ? <code>{raw.leadPipeline}</code> : "not set (leads aren't moved)"}</dd>
        <dt className="font-medium">Lead stage</dt>
        <dd>{raw?.leadStage ? <code>{raw.leadStage}</code> : "not set (any stage)"}</dd>
        <dt className="font-medium">GHL answered</dt>
        <dd>{!ghlConfig() ? "not called" : errorStatus !== null ? "with an error (below)" : `${pipelines.length} pipeline${pipelines.length === 1 ? "" : "s"}`}</dd>
      </dl>
      {configured && (
        <p className="callout mb-6 text-sm" role="status">
          Connected: new applications go to <strong>{configured.pipelineName}</strong>, stage{" "}
          <strong>{pipelines.flatMap((p) => p.stages ?? []).find((s) => s.id === configured.initialStage)?.name}</strong>, each
          application as its own opportunity.
          {configured.lead && (
            <>
              {" "}A lead&apos;s open opportunity in <strong>{configured.lead.pipelineName}</strong>
              {configured.lead.stageId && (
                <>
                  {" "}(stage{" "}
                  <strong>{pipelines.flatMap((p) => p.stages ?? []).find((s) => s.id === configured.lead!.stageId)?.name}</strong>)
                </>
              )}{" "}
              is moved over when they apply.
            </>
          )}
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
