import type { FormDefinition } from "@/lib/forms/types";
import { sportsFacilityApplication } from "./sports-facility-application";
import { specialEventApplication } from "./special-event-application";
import { groupVendorLiabilityApplication } from "./group-vendor-liability-application";
import { sportEventApplication } from "./sport-event-application";
import { campClinicApplication } from "./camp-clinic-application";
import { aerialInstructorApplication } from "./aerial-instructor-application";
import { martialArtsInstructorApplication } from "./martial-arts-instructor-application";
import { leisureSportEquipmentApplication } from "./leisure-sport-equipment-application";
import { equipmentFloaterApplication } from "./equipment-floater-application";

/** Register new forms here. The slug becomes the URL: /forms/<slug> */
const all: FormDefinition[] = [
  sportsFacilityApplication,
  sportEventApplication,
  campClinicApplication,
  specialEventApplication,
  groupVendorLiabilityApplication,
  martialArtsInstructorApplication,
  aerialInstructorApplication,
  leisureSportEquipmentApplication,
  equipmentFloaterApplication,
];

export const forms: Record<string, FormDefinition> = Object.fromEntries(all.map((f) => [f.slug, f]));

export const getForm = (slug: string): FormDefinition | undefined => forms[slug];
