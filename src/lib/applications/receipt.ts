import "server-only";
import { sign } from "@/lib/auth/session";

export const RECEIPT_AUDIENCE = "ais:receipt";

/** A one-hour link to the submitter's own PDF, shown on the confirmation screen. */
export async function receiptPath(applicationId: string) {
  return `/receipt/${await sign({ aid: applicationId }, 60 * 60, RECEIPT_AUDIENCE)}`;
}
