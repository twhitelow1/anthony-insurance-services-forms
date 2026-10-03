import { redirect } from "next/navigation";
import { entraConfig } from "@/lib/auth/entra";
import { getSession, safeReturnTo } from "@/lib/auth/session";

export const metadata = { title: "Staff sign-in | Anthony Insurance Services" };

export default async function AdminLogin({ searchParams }: PageProps<"/admin/login">) {
  const sp = await searchParams;
  const returnTo = safeReturnTo(typeof sp.returnTo === "string" ? sp.returnTo : null, "/admin");
  if ((await getSession())?.role === "staff") redirect(returnTo);
  const error = typeof sp.error === "string" ? sp.error : null;
  const configured = !!entraConfig();
  const devLogin = process.env.NODE_ENV !== "production" && process.env.DEV_STAFF_LOGIN === "1";

  return (
    <main className="mx-auto flex w-full max-w-md flex-1 flex-col justify-center px-4 py-16">
      <div className="card">
        <p className="mb-2 text-xs font-semibold uppercase tracking-[0.18em] text-[var(--accent-strong)]">Anthony Insurance Services</p>
        <h1 className="mb-2 text-2xl font-semibold">Staff sign-in</h1>
        <p className="mb-6 text-[var(--muted)]">Use your @anthonyinsuranceservices.com Microsoft 365 account.</p>
        {error && (
          <p className="mb-4 rounded-lg bg-[var(--danger-bg)] p-3 text-sm text-[var(--danger)]" role="alert">
            {error}
          </p>
        )}
        {configured ? (
          <a className="btn-primary w-full gap-3" href={`/api/auth/microsoft/login?returnTo=${encodeURIComponent(returnTo)}`}>
            <svg viewBox="0 0 21 21" className="h-5 w-5" aria-hidden="true">
              <path fill="#f25022" d="M1 1h9v9H1z" />
              <path fill="#7fba00" d="M11 1h9v9h-9z" />
              <path fill="#00a4ef" d="M1 11h9v9H1z" />
              <path fill="#ffb900" d="M11 11h9v9h-9z" />
            </svg>
            Sign in with Microsoft
          </a>
        ) : (
          <p className="callout callout-notice text-sm">Microsoft sign-in isn&apos;t configured yet (AZURE_TENANT_ID, AZURE_CLIENT_ID, AZURE_CLIENT_SECRET, APP_URL).</p>
        )}
        {devLogin && (
          <a className="btn-secondary mt-3 w-full" href="/api/auth/dev-login">
            Dev sign-in (local only)
          </a>
        )}
      </div>
    </main>
  );
}
