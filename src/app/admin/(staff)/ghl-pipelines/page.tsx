import { requireStaff } from "@/lib/auth/session";
import { GhlError, type GhlPipeline, ghlConfig, listPipelines } from "@/lib/ghl/client";
import { pipelineConfig } from "@/lib/ghl/sync";
import { STATUSES, STATUS_KEYS } from "@/lib/applications/status";

export const metadata = { title: "GHL pipelines | Anthony Insurance Services" };

/** Setup helper: shows the GHL pipeline and stage IDs to paste into Vercel. */
export default async function GhlPipelinesPage() {
  await requireStaff("/admin/ghl-pipelines");
  const configured = pipelineConfig();

  // Fetch first, render after: JSX built inside try/catch wouldn't have its render errors caught.
  let pipelines: GhlPipeline[] = [];
  let errorStatus: number | null = null;
  if (ghlConfig()) {
    try {
      pipelines = await listPipelines();
    } catch (err) {
      errorStatus = err instanceof GhlError ? err.status : 0;
    }
  }

  let body: React.ReactNode;
  if (!ghlConfig()) {
    body = <p className="callout callout-notice">Add GHL_API_TOKEN and GHL_LOCATION_ID in Vercel first, then redeploy.</p>;
  } else if (errorStatus !== null) {
    body = (
      <p className="rounded-lg bg-[var(--danger-bg)] p-3 text-sm text-[var(--danger)]">
        GHL refused the request{errorStatus ? ` (${errorStatus})` : ""}. Check that the Private Integration token has the View Opportunities scope.
      </p>
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
                {p.stages.map((s) => (
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
        Copy the pipeline ID into <code>GHL_PIPELINE_ID</code> and the first stage&apos;s ID into <code>GHL_PIPELINE_STAGE_ID</code>. To move
        opportunities when the status changes, set <code>GHL_STAGE_IDS</code> as JSON with these keys: {STATUS_KEYS.map((k) => `${k} (${STATUSES[k].label})`).join(", ")}.
      </p>
      {body}
    </div>
  );
}
