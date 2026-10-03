import { TopBar } from "@/components/portal";
import { requireStaff } from "@/lib/auth/session";

export default async function StaffLayout({ children }: LayoutProps<"/admin">) {
  const staff = await requireStaff();
  return (
    <>
      <TopBar title="Applications admin" href="/admin" who={staff.email} />
      <main className="mx-auto w-full max-w-6xl flex-1 px-4 py-8">{children}</main>
    </>
  );
}
