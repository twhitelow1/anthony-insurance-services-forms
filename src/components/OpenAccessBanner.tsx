import { openAccess } from "@/lib/auth/session";

/** Loud reminder that OPEN_ACCESS=1 has switched sign-in off. */
export function OpenAccessBanner() {
  if (!openAccess()) return null;
  return (
    <div className="bg-[var(--danger)] px-4 py-2 text-center text-sm font-medium text-white" role="alert">
      Testing mode: sign-in is off, so anyone with this link can see every application. Remove OPEN_ACCESS in Vercel to turn
      sign-in back on.
    </div>
  );
}
