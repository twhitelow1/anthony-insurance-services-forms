import Link from "next/link";
import { TopBar } from "@/components/portal";
import { requireStaff } from "@/lib/auth/session";
import { userModeAction } from "../actions";

export default async function StaffLayout({ children }: LayoutProps<"/admin">) {
  const staff = await requireStaff();
  return (
    <>
      <TopBar title="Applications admin" href="/admin" who={staff.email}>
        <nav className="flex flex-wrap items-center gap-4 font-medium">
          <Link href="/admin" className="hover:underline">Applications</Link>
          <Link href="/admin/applicants" className="hover:underline">Applicants</Link>
          <Link href="/admin/assistant" className="hover:underline">Ask AI</Link>
          <Link href="/admin/ghl-pipelines" className="hover:underline">GHL setup</Link>
          <form action={userModeAction}>
            <button className="btn-link font-medium" title="See the client portal for your own email address">Switch to user mode</button>
          </form>
        </nav>
      </TopBar>
      <main className="mx-auto w-full max-w-6xl flex-1 px-4 py-8">{children}</main>
    </>
  );
}
