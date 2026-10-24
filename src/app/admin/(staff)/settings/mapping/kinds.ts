import type { MappingKind } from "@/lib/db/schema";

/** The mapping screens' addresses. */
export const KIND_SLUGS: Record<string, MappingKind> = {
  "salesforce-import": "salesforce_import",
  "lead-alchemist-companies": "la_companies",
  "salesforce-push": "salesforce_push",
};
export const slugFor = (kind: MappingKind) => Object.entries(KIND_SLUGS).find(([, k]) => k === kind)![0];
