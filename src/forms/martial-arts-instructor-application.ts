import { isYes, opts, text, US_STATES, yesNo } from "@/lib/forms/helpers";
import type { Field, FormDefinition } from "@/lib/forms/types";

/**
 * Martial Arts / Self Defense Instructor — General Liability enrollment.
 * Transcribed from the Lead Alchemist form cxjHXnrzqLgvYRk6Vme9; limits chart and
 * clarifications cross-checked against carrier form MASS MERCH MA INST 1610-MK 1/2025.
 */

function additionalInsuredFields(n: number): Field[] {
  return [
    { type: "content", id: `ai_${n}_heading`, variant: "subheading", title: `Additional Insured #${n}` },
    text(`ai_${n}_name`, "Name"),
    text(`ai_${n}_address`, "Address"),
    text(`ai_${n}_city`, "City", { width: "third" }),
    { type: "select", id: `ai_${n}_state`, label: "State", options: US_STATES, width: "third" },
    text(`ai_${n}_zip`, "Zip Code", { width: "third" }),
  ];
}

const optional = { required: false } as const;

export const martialArtsInstructorApplication: FormDefinition = {
  slug: "martial-arts-instructor-application",
  title: "Martial Arts/Self Defense Instructor Application",
  subtitle: "General Liability coverage for martial arts and self defense instructors",
  tags: ["form:martial-arts-instructor-application", "martial-arts"],
  source: "Anthony Insurance Forms — Martial Arts/Self Defense Instructor Application",
  successMessage:
    "Thank you! Your application has been submitted. An Anthony Insurance Services agent will review it and reach out shortly.",
  sections: [
    {
      id: "applicant",
      title: "Applicant Information",
      fields: [
        text("first_name", "First Name", { required: true, width: "half", ghl: { standard: "firstName" } }),
        text("last_name", "Last Name", { required: true, width: "half", ghl: { standard: "lastName" } }),
        text("legal_business_name", "Business Name or (DBA):", { ghl: { standard: "companyName" } }),
        text("mailing_address", "Street Address", { required: true, ghl: { standard: "address1" } }),
        text("mailing_city", "City", { width: "third", ghl: { standard: "city" } }),
        { type: "select", id: "mailing_state", label: "State", options: US_STATES, width: "third", ghl: { standard: "state" } },
        text("mailing_postal_code", "Postal Code", { width: "third", ghl: { standard: "postalCode" } }),
        { type: "tel", id: "phone", label: "Phone", required: true, width: "half", ghl: { standard: "phone" } },
        { type: "email", id: "email", label: "Email", required: true, width: "half", ghl: { standard: "email" } },
        { type: "date", id: "requested_effective_date", label: "Start Date", required: true, width: "half" },
      ],
    },
    {
      id: "operations",
      title: "Instructor Operations",
      fields: [
        yesNo("age_18_or_older", "Are You 18 Years Or Older?"),
        yesNo("uses_weapons", "Do You Use Weapons As Part Of Your Instruction?"),
        yesNo("weapons_sharpened", "Are They Sharpened/Bladed?", { ...optional, showIf: isYes("uses_weapons") }),
        yesNo("weapons_replicas", "Are The Weapons Replicas?", { ...optional, showIf: isYes("uses_weapons") }),
        yesNo("weapons_ammunition", "Do They Contain Ammunition?", { ...optional, showIf: isYes("uses_weapons") }),
        yesNo("tasers_sprays", "Do You Use Tasers Or Defense Sprays?", { ...optional, showIf: isYes("uses_weapons") }),
        yesNo("own_facility_or_employees", "Do You Own Or Operate Your Own Facility And/Or Have Employees/Volunteers?", optional),
        yesNo(
          "self_defense_law_enforcement",
          "Do You Teach Any Self-Defense Classes or Classes Designed Specifically for Law Enforcement?",
          optional,
        ),
        { type: "textarea", id: "martial_arts_styles", label: "What Are The Type(s) Of Martial Arts Style(s) Do You Teach?" },
        {
          type: "checkboxes",
          id: "annual_coverage_option",
          label: "Annual Coverage Option",
          options: opts("Yes"),
        },
        {
          type: "radio",
          id: "instructor_type",
          label: "Type of Instructor",
          options: opts("Martial Arts Instructor", "Self Defense / Law Enforcement/Securirty Instructor"),
        },
      ],
    },
    {
      id: "prior_coverage",
      title: "Current Coverage & Loss History",
      fields: [
        yesNo("current_coverage", "Do you have current coverage in place?", optional),
        {
          type: "textarea",
          id: "no_coverage_reason",
          label: "If No, please explain by entering New Business Operation or provide the reason no coverage is in place",
          showIf: (v) => v.current_coverage === "No",
        },
        {
          type: "textarea",
          id: "current_carrier",
          label: "If Yes, provide the name of your current carrier and your policy's expiration date",
          showIf: isYes("current_coverage"),
        },
        yesNo("carrier_non_renewing", "Is your current carrier non-renewing coverage?", { ...optional, showIf: isYes("current_coverage") }),
        {
          type: "textarea",
          id: "non_renewing_reason",
          label: "If Yes, why?",
          showIf: isYes("carrier_non_renewing"),
        },
        yesNo("claims_over_5000", "In the past 5 years, have you had more than $5,000 in claims?", optional),
        {
          type: "content",
          id: "claims_notice",
          variant: "info",
          body: "If Yes, please provide current loss runs with at least 5 years of loss history, including your current year. In addition, please describe any liability or medical claims over $5,000 that have been paid under your insurance coverage for those years.",
          showIf: isYes("claims_over_5000"),
        },
      ],
    },
    {
      id: "limits",
      title: "General Liability Limits",
      description: "Use the chart below to select the desired liability limit",
      fields: [
        {
          type: "content",
          id: "limits_chart",
          variant: "info",
          title: "Coverage options (each occurrence / annual cost)",
          body: [
            "Option 1: $1,000,000 — Martial Arts Instructor $375.00; Self Defense/Law Enforcement/Security Instructor $582.00",
            "Option 2: $2,000,000 — Martial Arts Instructor $553.00; Self Defense/Law Enforcement/Security Instructor $863.00",
            "Option 3: $3,000,000 — Martial Arts Instructor $803.00; Self Defense/Law Enforcement/Security Instructor $1,113.00",
            "Option 4: $4,000,000 — Martial Arts Instructor $1,053.00; Self Defense/Law Enforcement/Security Instructor $1,363.00",
            "Option 5: $5,000,000 — Martial Arts Instructor $1,303.00; Self Defense/Law Enforcement/Security Instructor $1,613.00",
            "All options: $5,000,000 General Aggregate; Products-Completed Operations, Personal & Advertising Injury, Bodily Injury to Participants and Professional Liability equal to the each-occurrence limit; $1,000,000 Damage to Premises Rented to You; $5,000 Medical Expense (other than participants). Costs include premium and a $20 risk purchasing group administration fee.",
          ],
        },
        {
          type: "radio",
          id: "liability_limit",
          label: "Select the desired liability limit:",
          options: opts("Option 1", "Option 2", "Option 3", "Option 4", "Option 5"),
        },
      ],
    },
    {
      id: "additional_insured",
      title: "Certificate Requests",
      description:
        "Use the fields below to list Additional Insured Certificate Request by including the Name and Address of the Entity. If you don't have or need any Additional Insured Requests, then you can skip this section.",
      fields: [1, 2, 3].flatMap(additionalInsuredFields),
    },
    {
      id: "signature",
      title: "Signature",
      fields: [
        {
          type: "checkboxes",
          id: "terms_agreement",
          label: "Terms & Conditions",
          options: opts(
            "I agree to terms & conditions provided by the company. By providing my phone number, I agree to receive text messages from the business. The information provided in this application is true to the best of my ability.",
          ),
          required: true,
        },
        { type: "signature", id: "signature", label: "Signature of applicant:", required: true },
      ],
    },
  ],
};
