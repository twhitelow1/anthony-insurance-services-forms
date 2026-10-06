import { verifyStaffLinkAction } from "../login-actions";

export const metadata = { title: "Staff sign-in | Anthony Insurance Services", referrer: "no-referrer" };

/** The emailed staff link lands here; signing in takes a click (POST), so link scanners can't spend it. */
export default async function StaffVerify({ searchParams }: PageProps<"/admin/verify">) {
  const { token, returnTo } = await searchParams;
  return (
    <main className="mx-auto flex w-full max-w-md flex-1 flex-col justify-center px-4 py-16">
      <form action={verifyStaffLinkAction} className="card text-center">
        <input type="hidden" name="token" value={typeof token === "string" ? token : ""} />
        <input type="hidden" name="returnTo" value={typeof returnTo === "string" ? returnTo : ""} />
        <h1 className="mb-2 text-2xl font-semibold">Staff sign-in</h1>
        <p className="mb-6 text-[var(--muted)]">Continue to the applications admin.</p>
        <button className="btn-primary w-full">Continue</button>
      </form>
    </main>
  );
}
