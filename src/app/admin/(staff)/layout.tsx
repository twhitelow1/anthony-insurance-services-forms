import Link from "next/link";
import { TopBar } from "@/components/portal";
import { NavMenu } from "@/components/NavMenu";
import { requireStaff } from "@/lib/auth/session";
import { userModeAction } from "../actions";
import { OpenAccessBanner } from "@/components/OpenAccessBanner";
import { ShiftClickRange } from "@/components/ShiftClickRange";
import { SaveProgress } from "@/components/SaveProgress";

/** When this render happened (outside the component, so it isn't mistaken for impure render code). */
async function renderStamp() {
  return Date.now();
}
import { after } from "next/server";
import { runDueJobs } from "@/lib/salesforce/jobs";
import { countActive } from "@/lib/notifications/repo";

// Signed-in pages read live data on every request (with OPEN_ACCESS no cookie is read, so Next would otherwise render them once at build).
export const dynamic = "force-dynamic";

export default async function StaffLayout({ children }: LayoutProps<"/admin">) {
  const staff = await requireStaff();
  const alerts = await countActive().catch(() => 0);
  // A fresh value on every server render, so the save progress bar knows the new page arrived.
  const renderedAt = await renderStamp();
  // Retries that are due (e.g. Salesforce was down) run after the page is sent. Never blocks it.
  after(() => runDueJobs(3).catch((err) => console.error("[jobs] due-job run failed", err)));
  return (
    <>
      <OpenAccessBanner />
      <ShiftClickRange />
      <SaveProgress stamp={renderedAt} />
      <TopBar title="AIS Connect" href="/admin" who={staff.email}>
        <nav className="flex flex-wrap items-center gap-4 font-medium">
          <NavMenu
            label="Applications"
            items={[
              { href: "/admin", label: "View all" },
              { href: "/admin/unfinished", label: "Unfinished" },
              { href: "/admin/forms", label: "Forms" },
              { href: "/admin/documents", label: "Documents" },
            ]}
          />
          <NavMenu
            label="Accounts"
            items={[
              { href: "/admin/clients", label: "View all" },
              { href: "/admin/contacts", label: "Contacts" },
              { href: "/admin/mapping", label: "Mapping" },
            ]}
          />
          <Link href="/admin/notifications" className="hover:underline">
            Notifications{alerts > 0 && <span className="badge badge-warning ml-1">{alerts}</span>}
          </Link>
          <Link href="/admin/assistant" className="hover:underline">Ask AI</Link>
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
