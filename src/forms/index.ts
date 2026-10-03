import type { FormDefinition } from "@/lib/forms/types";
import { sportsFacilityApplication } from "./sports-facility-application";

/** Register new forms here. The slug becomes the URL: /forms/<slug> */
export const forms: Record<string, FormDefinition> = {
  [sportsFacilityApplication.slug]: sportsFacilityApplication,
};

export const getForm = (slug: string): FormDefinition | undefined => forms[slug];
