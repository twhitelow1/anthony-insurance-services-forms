import { verifyLinkAction } from "../actions";

export const metadata = { title: "Sign in | Anthony Insurance Services", referrer: "no-referrer" };

/**
 * The emailed link lands here. Signing in requires clicking the button (a POST), so
 * email security scanners that pre-open links don't use up the one-time token.
 */
export default async function Verify({ searchParams }: PageProps<"/portal/verify">) {
  const { token } = await searchParams;
  return (
    <main className="mx-auto flex w-full max-w-md flex-1 flex-col justify-center px-4 py-16">
      <form action={verifyLinkAction} className="card text-center">
        <input type="hidden" name="token" value={typeof token === "string" ? token : ""} />
        <h1 className="mb-2 text-2xl font-semibold">Sign in</h1>
        <p className="mb-6 text-[var(--muted)]">Continue to view your applications.</p>
        <button className="btn-primary w-full">Continue</button>
      </form>
    </main>
  );
}
