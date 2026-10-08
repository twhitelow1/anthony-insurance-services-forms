import Link from "next/link";
import { TopBar } from "@/components/portal";
import { requireStaff } from "@/lib/auth/session";
import { userModeAction } from "../actions";
import { OpenAccessBanner } from "@/components/OpenAccessBanner";

// Signed-in pages read live data on every request (with OPEN_ACCESS no cookie is read, so Next would otherwise render them once at build).
export const dynamic = "force-dynamic";

export default async function StaffLayout({ children }: LayoutProps<"/admin">) {
  const staff = await requireStaff();
  return (
    <>
      <OpenAccessBanner />
      <TopBar title="Applications admin" href="/admin" who={staff.email}>
        <nav className="flex flex-wrap items-center gap-4 font-medium">
          <Link href="/admin" className="hover:underline">Applications</Link>
          <Link href="/admin/applicants" className="hover:underline">Applicants</Link>
          <Link href="/admin/assistant" className="hover:underline">Ask AI</Link>
          <Link href="/admin/ghl-pipelines" className="hover:underline">GHL setup</Link>
          <Link href="/admin/settings" className="hover:underline">Settings</Link>
          <form action={userModeAction}>
            <button className="btn-link font-medium" title="See the client portal for your own email address">Switch to user mode</button>
          </form>
        </nav>
      </TopBar>
      <main className="mx-auto w-full max-w-6xl flex-1 px-4 py-8">{children}</main>
    </>
  );
}
