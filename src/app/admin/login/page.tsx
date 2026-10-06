import { redirect } from "next/navigation";
import { entraConfig } from "@/lib/auth/entra";
import { getSession, safeReturnTo } from "@/lib/auth/session";
import { requestStaffLinkAction } from "../login-actions";

export const metadata = { title: "Staff sign-in | Anthony Insurance Services" };

export default async function AdminLogin({ searchParams }: PageProps<"/admin/login">) {
  const sp = await searchParams;
  const returnTo = safeReturnTo(typeof sp.returnTo === "string" ? sp.returnTo : null, "/admin");
  if ((await getSession())?.role === "staff") redirect(returnTo);
  const error = typeof sp.error === "string" ? sp.error : null;
  const microsoft = !!entraConfig();
  const devLogin = process.env.NODE_ENV !== "production" && process.env.DEV_STAFF_LOGIN === "1";

  return (
    <main className="mx-auto flex w-full max-w-md flex-1 flex-col justify-center px-4 py-16">
      <div className="card">
        <p className="mb-2 text-xs font-semibold uppercase tracking-[0.18em] text-[var(--accent-strong)]">Anthony Insurance Services</p>
        <h1 className="mb-2 text-2xl font-semibold">Staff sign-in</h1>

        {sp.sent ? (
          <div role="status">
            <p className="mb-4">If that&apos;s a staff address, a sign-in link is on its way. It works once and expires in 20 minutes.</p>
            <p className="text-sm text-[var(--muted)]">
              Didn&apos;t get it? Check spam or quarantine, or <a className="btn-link" href="/admin/login">try again</a>.
            </p>
          </div>
        ) : (
          <>
            <p className="mb-6 text-[var(--muted)]">Enter your @anthonyinsuranceservices.com email and we&apos;ll send you a one-time sign-in link.</p>
            {(error || sp.expired) && (
              <p className="mb-4 rounded-lg bg-[var(--danger-bg)] p-3 text-sm text-[var(--danger)]" role="alert">
                {error ?? "That sign-in link has expired or was already used. Request a new one below."}
              </p>
            )}
            <form action={requestStaffLinkAction} className="space-y-3">
              <input type="hidden" name="returnTo" value={returnTo} />
              <label htmlFor="email" className="field-label">Work email</label>
              <input id="email" name="email" type="email" required autoComplete="email" className="input" />
              <button className="btn-primary w-full">Email me a sign-in link</button>
            </form>
            {microsoft && (
              <a className="btn-secondary mt-3 w-full" href={`/api/auth/microsoft/login?returnTo=${encodeURIComponent(returnTo)}`}>
                Sign in with Microsoft instead
              </a>
            )}
            {devLogin && (
              <a className="btn-secondary mt-3 w-full" href="/api/auth/dev-login">
                Dev sign-in (local only)
              </a>
            )}
          </>
        )}
      </div>
    </main>
  );
}
