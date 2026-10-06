import { num, opts, text, US_STATES } from "@/lib/forms/helpers";
import type { Field, FormDefinition, FormValues } from "@/lib/forms/types";

/**
 * Group Vendor Liability — Show Setup Form (for show promoters & producers who cover their vendors).
 * Transcribed from the Lead Alchemist (GHL) form 4DPE8U76f8NuMA1dZV9M
 * (older website version: anthonyinsuranceservices.com/forms/group-vendor-liability/).
 */

const insuredCount = (v: FormValues) => Number(v.additional_insured_count ?? 0);

function additionalInsuredFields(n: number): Field[] {
  const suffix = n === 1 ? "" : ` #${String(n).padStart(2, "0")}`;
  const p = `ai_${n}`;
  const showIf = (v: FormValues) => insuredCount(v) >= n;
  return [
    { type: "content", id: `${p}_heading`, variant: "subheading", title: `Insured #${String(n).padStart(2, "0")}`, showIf },
    text(`${p}_name`, `Insured Name${suffix}`, { required: true, showIf }),
    text(`${p}_street`, `Insured Street Address${suffix}`, { showIf }),
    text(`${p}_city`, `Insured City${suffix}`, { width: "third", showIf }),
    { type: "select", id: `${p}_state`, label: `Insured State${suffix}`, options: US_STATES, width: "third", showIf },
    text(`${p}_zip`, `Insured ZIP Code${suffix}`, { width: "third", showIf }),
    text(`${p}_relationship`, `Insured Relationship${suffix}`, {
      showIf,
      placeholder: "e.g. Venue / Landlord / Event Management Company",
    }),
  ];
}

export const groupVendorLiabilityApplication: FormDefinition = {
  slug: "group-vendor-liability-application",
  title: "Group Vendor Liability Application",
  subtitle: "Show setup for promoters & producers covering their vendors",
  tags: ["form:group-vendor-liability-application", "special-event"],
  source: "Anthony Insurance Forms — Group Vendor Liability Application",
  successMessage:
    "Thank you! Your application has been submitted. An Anthony Insurance Services agent will review it and reach out shortly.",
  sections: [
    {
      id: "contact",
      title: "Contact Information",
      fields: [
        text("legal_business_name", "Company Name", { required: true, ghl: { standard: "companyName" } }),
        { type: "content", id: "mailing_heading", variant: "subheading", title: "Address" },
        text("mailing_address", "Street Address", { required: true, ghl: { standard: "address1" } }),
        text("mailing_city", "City", { required: true, width: "third", ghl: { standard: "city" } }),
        { type: "select", id: "mailing_state", label: "State", options: US_STATES, required: true, width: "third", ghl: { standard: "state" } },
        text("mailing_postal_code", "ZIP Code", { required: true, width: "third", ghl: { standard: "postalCode" } }),
        { type: "content", id: "contact_heading", variant: "subheading", title: "Contact Name" },
        text("first_name", "First Name", { required: true, width: "half", ghl: { standard: "firstName" } }),
        text("last_name", "Last Name", { required: true, width: "half", ghl: { standard: "lastName" } }),
        { type: "email", id: "email", label: "Email", required: true, width: "half", ghl: { standard: "email" } },
        // Not on the source form; added so every application has a phone on the GHL contact.
        { type: "tel", id: "phone", label: "Phone", required: true, width: "half", ghl: { standard: "phone" } },
      ],
    },
    {
      id: "show",
      title: "Show Information",
      fields: [
        text("show_name", "Name Of Show", { required: true }),
        {
          type: "textarea",
          id: "show_dates",
          label: "Show Dates",
          required: true,
          tooltip:
            "Please list or describe applicable show dates. All policies expire at 12:01 AM on the date of expiration. If you have a 3-day event starting on 4/1/2022 and concluding on 4/3/2022, the desired coverage term would be 4/1/2022 - 4/4/2022. The policy will expire on 4/4/2022 @ 12:01 AM",
        },
        {
          type: "date",
          id: "requested_effective_date",
          label: "Policy Start Date",
          required: true,
          width: "half",
          tooltip: "Enter date the policy to start (includes set up day(s))",
        },
        {
          type: "date",
          id: "policy_end_date",
          label: "Policy End Date",
          required: true,
          width: "half",
          tooltip: "Enter in the date the policy will expire. Policies expire on the date at 12:01 AM",
        },
        {
          type: "select",
          id: "general_aggregate_limit",
          label: "Select General Aggregate Limit",
          options: opts("$1,000,000", "$2,000,000", "$3,000,000", "$4,000,000", "$5,000,000"),
          width: "half",
          tooltip:
            "Please select the desired Aggregate Limit for the policy. All policies are issued with a $1,000,000 per occurrence limit.",
        },
      ],
    },
    {
      id: "venue",
      title: "Venue Information",
      fields: [
        text("venue_name", "Venue Name or Location of Event", { required: true }),
        text("venue_street", "Venue Street Address", { required: true }),
        text("venue_address_line_2", "Venue Address Line", { placeholder: "Suite, building, hall, etc." }),
        text("venue_city", "Venue City", { required: true, width: "third" }),
        { type: "select", id: "venue_state", label: "Venue State", options: US_STATES, required: true, width: "third" },
        text("venue_zip", "Venue ZIP Code", { required: true, width: "third" }),
      ],
    },
    {
      id: "additional_insured",
      title: "Additional Insured",
      description: "Include relationship of additional insured - i.e. Venue/Landlord/Event Management Company, etc.",
      fields: [
        {
          type: "select",
          id: "additional_insured_count",
          label: "Please select the number of insureds.",
          options: opts("0", "1", "2", "3", "4", "5"),
          width: "half",
        },
        ...[1, 2, 3, 4, 5].flatMap(additionalInsuredFields),
      ],
    },
    {
      id: "other",
      title: "Other Details",
      fields: [
        { type: "textarea", id: "certificate_language", label: "Please provide any specific certificate language requests", required: true },
        { type: "email", id: "certificate_email", label: "Email address to receive certificate copies", required: true },
        num("total_exhibitors", "Estimated number of total exhibitors", { required: true, width: "half" }),
        num("exhibitors_purchasing", "Estimated number of exhibitors purchasing coverage", { required: true, width: "half" }),
      ],
    },
    {
      id: "signature",
      title: "Signature",
      fields: [
        // The source form has no signature or representations text; a signature is added per app convention.
        { type: "signature", id: "signature", label: "Authorized Electronic Signature", required: true },
      ],
    },
  ],
};
