import Link from "next/link";
import { TopBar } from "@/components/portal";
import { requireStaff } from "@/lib/auth/session";

export default async function StaffLayout({ children }: LayoutProps<"/admin">) {
  const staff = await requireStaff();
  return (
    <>
      <TopBar title="Applications admin" href="/admin" who={staff.email}>
        <nav className="flex gap-4 font-medium">
          <Link href="/admin" className="hover:underline">Applications</Link>
          <Link href="/admin/assistant" className="hover:underline">Ask AI</Link>
        </nav>
      </TopBar>
      <main className="mx-auto w-full max-w-6xl flex-1 px-4 py-8">{children}</main>
    </>
  );
}
