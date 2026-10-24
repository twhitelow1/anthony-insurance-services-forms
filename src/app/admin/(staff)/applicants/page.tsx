import { redirect } from "next/navigation";
import { requireStaff } from "@/lib/auth/session";

/** Applicants became Admin → Clients (one client can have several emails). Old links land there. */
export default async function Applicants() {
  await requireStaff("/admin/clients");
  redirect("/admin/clients");
}
