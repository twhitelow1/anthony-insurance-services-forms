import type { FormDefinition } from "@/lib/forms/types";
import { boxingGymApplication, gymnasticsApplication, sportsFacilityApplication } from "./sports-facility-application";
import { specialEventApplication } from "./special-event-application";
import { groupVendorLiabilityApplication } from "./group-vendor-liability-application";
import { sportEventApplication } from "./sport-event-application";
import { campClinicApplication } from "./camp-clinic-application";
import { aerialInstructorApplication } from "./aerial-instructor-application";
import { martialArtsInstructorApplication } from "./martial-arts-instructor-application";
import { leisureSportEquipmentApplication } from "./leisure-sport-equipment-application";
import { equipmentFloaterApplication } from "./equipment-floater-application";
import { larpEventApplication } from "./larp-event-application";
import { martialArtsEventApplication } from "./martial-arts-event-application";
import { aerialDanceStudioApplication, aerialYogaStudioApplication } from "./aerial-studio-application";
import { fitnessFacilityApplication } from "./fitness-facility-application";

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
  larpEventApplication,
  martialArtsEventApplication,
  aerialYogaStudioApplication,
  aerialDanceStudioApplication,
  fitnessFacilityApplication,
  gymnasticsApplication,
  boxingGymApplication,
];

export const forms: Record<string, FormDefinition> = Object.fromEntries(all.map((f) => [f.slug, f]));

export const getForm = (slug: string): FormDefinition | undefined => forms[slug];
