import { TopBar } from "@/components/portal";
import { requireClient } from "@/lib/auth/session";

export default async function ClientLayout({ children }: LayoutProps<"/portal">) {
  const client = await requireClient();
  return (
    <>
      <TopBar title="My applications" href="/portal" who={client.email} />
      <main className="mx-auto w-full max-w-3xl flex-1 px-4 py-8">{children}</main>
    </>
  );
}
