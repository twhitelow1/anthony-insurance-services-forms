import { TopBar } from "@/components/portal";
import { requirePortalViewer } from "@/lib/auth/session";
import { exitUserModeAction } from "@/app/admin/actions";

export default async function ClientLayout({ children }: LayoutProps<"/portal">) {
  const viewer = await requirePortalViewer();
  return (
    <>
      <TopBar title="My applications" href="/portal" who={viewer.staff ? viewer.staffEmail : viewer.email}>
        {viewer.staff && (
          <form action={exitUserModeAction}>
            <button className="btn-link font-medium">Switch to admin</button>
          </form>
        )}
      </TopBar>
      {viewer.staff && (
        <div className="border-b border-[var(--border)] bg-[var(--accent-soft)] px-4 py-2 text-center text-sm">
          {viewer.previewing ? (
            <>
              User mode: you&apos;re seeing the portal exactly as <strong>{viewer.email}</strong> sees it.
            </>
          ) : (
            <>User mode: the applications submitted with your email address.</>
          )}
        </div>
      )}
      <main className="mx-auto w-full max-w-3xl flex-1 px-4 py-8">{children}</main>
    </>
  );
}
