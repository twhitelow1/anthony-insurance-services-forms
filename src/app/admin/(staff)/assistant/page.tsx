import { AssistantChat } from "@/components/AssistantChat";
import { requireStaff } from "@/lib/auth/session";
import { askAssistantAction } from "../../actions";

export const metadata = { title: "Ask AI | Anthony Insurance Services" };

export default async function AssistantPage() {
  await requireStaff("/admin/assistant");
  return (
    <div className="mx-auto max-w-3xl">
      <h1 className="text-2xl font-semibold">Ask about applications</h1>
      <p className="mb-6 text-sm text-[var(--muted)]">
        Claude searches the portal&apos;s applications for you and links every application it mentions. It can read but not change anything.
      </p>
      <AssistantChat ask={askAssistantAction} enabled={!!process.env.ANTHROPIC_API_KEY} />
    </div>
  );
}
