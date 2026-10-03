import { redirect } from "next/navigation";
import { getSession } from "@/lib/auth/session";
import { requestLinkAction } from "../actions";

export const metadata = { title: "Check your application | Anthony Insurance Services" };

export default async function PortalLogin({ searchParams }: PageProps<"/portal/login">) {
  if ((await getSession())?.role === "client") redirect("/portal");
  const sp = await searchParams;

  return (
    <main className="mx-auto flex w-full max-w-md flex-1 flex-col justify-center px-4 py-16">
      <div className="card">
        <p className="mb-2 text-xs font-semibold uppercase tracking-[0.18em] text-[var(--accent-strong)]">Anthony Insurance Services</p>
        <h1 className="mb-2 text-2xl font-semibold">Check your application</h1>
        {sp.sent ? (
          <div role="status">
            <p className="mb-4">If we have an application for that email, a sign-in link is on its way. It expires in 20 minutes.</p>
            <p className="text-sm text-[var(--muted)]">Didn&apos;t get it? Check your spam folder, or <a className="btn-link" href="/portal/login">try again</a>.</p>
          </div>
        ) : (
          <>
            <p className="mb-6 text-[var(--muted)]">Enter the email you used on your application. We&apos;ll email you a one-time sign-in link — no password needed.</p>
            {sp.expired && (
              <p className="mb-4 rounded-lg bg-[var(--danger-bg)] p-3 text-sm text-[var(--danger)]" role="alert">
                That sign-in link has expired or was already used. Request a new one below.
              </p>
            )}
            <form action={requestLinkAction} className="space-y-3">
              <label htmlFor="email" className="field-label">Email</label>
              <input id="email" name="email" type="email" required autoComplete="email" className="input" />
              <button className="btn-primary w-full">Email me a sign-in link</button>
            </form>
          </>
        )}
      </div>
    </main>
  );
}
