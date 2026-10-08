import { is, isYes, money, num, opts, text, US_STATES, yesNo } from "@/lib/forms/helpers";
import type { Field, FormDefinition } from "@/lib/forms/types";

/**
 * Special Event Insurance Application.
 * Transcribed from the Lead Alchemist form ZyanGA4wMPk3RcUjFsW5
 * (older website version: anthonyinsuranceservices.com/forms/special-event-insurance-application/).
 */

function additionalInsuredFields(n: number): Field[] {
  const suffix = n === 1 ? "" : ` #${String(n).padStart(2, "0")}`;
  const p = `ai_${n}`;
  return [
    {
      type: "content",
      id: `${p}_heading`,
      variant: "subheading",
      title: n === 1 ? "Additional Insured" : `Insured${suffix}`,
    },
    text(`${p}_name`, `Insured Name${suffix}`),
    text(`${p}_street`, `Insured Street Address${suffix}`),
    text(`${p}_city`, `Insured City${suffix}`, { width: "third" }),
    { type: "select", id: `${p}_state`, label: `Insured State${suffix}`, options: US_STATES, width: "third" },
    text(`${p}_zip`, `Insured ZIP Code${suffix}`, { width: "third" }),
    text(`${p}_relationship`, `Insured Relationship${suffix}`),
  ];
}

const liquorSold = isYes("liquor_sold");

export const specialEventApplication: FormDefinition = {
  slug: "special-event-application",
  title: "Special Event Insurance Application",
  subtitle: "General Liability coverage for special events",
  tags: ["form:special-event-application", "special-event"],
  source: "Anthony Insurance Forms — Special Event Insurance Application",
  successMessage:
    "Thank you! Your application has been submitted. An Anthony Insurance Services agent will review it and reach out shortly.",
  sections: [
    {
      id: "policyholder",
      title: "Policyholder Information",
      fields: [
        text("legal_business_name", "Name of Policyholder", {
          required: true,
          tooltip:
            "The name of the business/organization purchasing the insurance; as it will appear on the policy documents and/or other contract or rental agreements.",
          ghl: { standard: "companyName" },
        }),
        { type: "content", id: "mailing_heading", variant: "subheading", title: "Address" },
        text("mailing_address", "Street Address", { required: true, ghl: { standard: "address1" } }),
        text("mailing_city", "City", { required: true, width: "third", ghl: { standard: "city" } }),
        { type: "select", id: "mailing_state", label: "State", options: US_STATES, required: true, width: "third", ghl: { standard: "state" } },
        text("mailing_postal_code", "Postal Code", { required: true, width: "third", ghl: { standard: "postalCode" } }),
        { type: "content", id: "contact_heading", variant: "subheading", title: "Contact Name" },
        text("first_name", "First Name", { required: true, width: "half", ghl: { standard: "firstName" } }),
        text("last_name", "Last Name", { required: true, width: "half", ghl: { standard: "lastName" } }),
        { type: "tel", id: "phone", label: "Phone", required: true, width: "half", ghl: { standard: "phone" } },
        { type: "email", id: "email", label: "Email", required: true, width: "half", ghl: { standard: "email" } },
        { type: "url", id: "website", label: "Organization / Event Website", placeholder: "www.example.com", ghl: { standard: "website" } },
      ],
    },
    {
      id: "event",
      title: "Event Details",
      fields: [
        text("event_name", "Name of Event", { required: true }),
        { type: "content", id: "coverage_dates_heading", variant: "subheading", title: "Desired coverage date (including setup and tear down):" },
        { type: "date", id: "requested_effective_date", label: "Start Date", required: true, width: "half" },
        { type: "date", id: "coverage_end_date", label: "End Date", required: true, width: "half" },
        { type: "date", id: "event_date", label: "Date of Event", width: "half" },
        text("event_start_time", "Event Start Time", { required: true, width: "half", placeholder: "e.g. 9:00 AM" }),
        text("event_end_time", "Event End Time", { required: true, width: "half", placeholder: "e.g. 5:00 PM" }),
        num("attendance_per_day", "Estimated Attendance Per Day", { required: true, width: "half" }),
        money("gross_receipts", "Estimated Gross Receipts", { required: true, width: "half" }),
        yesNo("live_music", "Is there a live musical performance at the event?"),
        {
          type: "textarea",
          id: "music_genre_artists",
          label: "Please provide the genre of music and all performing artists:",
          showIf: isYes("live_music"),
        },
        {
          type: "textarea",
          id: "event_description",
          label: "Description of Event",
          required: true,
          tooltip:
            "Please provide a detailed list of all activities to be held or what will take place for the duration of your event to ensure your event is quoted properly and returned promptly.",
        },
        text("venue_name", "Name of Venue/Facility where event is being held:"),
        text("event_street", "Event Street Address", { required: true }),
        text("event_city", "Event City", { required: true, width: "third" }),
        { type: "select", id: "event_state", label: "Event State", options: US_STATES, required: true, width: "third" },
        text("event_zip", "Event ZIP Code", { required: true, width: "third" }),
        {
          type: "radio",
          id: "facility_liability_insurance",
          label: "Does the facility carry liability insurance?",
          options: opts("Yes", "No", "Not Sure"),
          required: true,
        },
        yesNo("multiple_locations", "Is the event held at more than one location?"),
        { type: "textarea", id: "multiple_locations_details", label: "Please Describe", showIf: isYes("multiple_locations") },
        yesNo("overnight_camping", "Are overnight accommodations or camping part of the event?"),
        text("security_provider", "Who is responsible for providing security?", { required: true }),
      ],
    },
    {
      id: "insurance",
      title: "Insurance Details",
      fields: [
        { type: "content", id: "occurrence_note", variant: "info", body: "All policies are issued with a $1,000,000 per occurrence." },
        {
          type: "radio",
          id: "general_aggregate_limit",
          label: "Please select the General Liability Aggregate Limit:",
          options: opts("$1,000,000", "$2,000,000", "$3,000,000", "$4,000,000", "$5,000,000"),
        },
        yesNo("liquor_sold", "Will liquor be sold at the event?"),
        num("attendees_consuming_alcohol", "Number of attendees consuming alcohol daily?", { width: "half", showIf: liquorSold }),
        yesNo("alcohol_vendors_liquor_limits", "Are all participating alcohol vendors required to carry minimum liquor liability limits for this event?", {
          required: false,
          showIf: liquorSold,
        }),
        yesNo("liquor_license_required", "Is a liquor license (or liquor permit) required for this event?", { required: false, showIf: liquorSold }),
        yesNo("valid_liquor_license", "Does application have a valid liquor license?", { required: false, showIf: liquorSold }),
        money("alcohol_receipts_per_day", "Estimated gross receipts per day alcohol:", { width: "half", showIf: liquorSold }),
        money("alcohol_receipts_total", "Total estimated gross receipts for event for alcohol:", { width: "half", showIf: liquorSold }),
        yesNo("liquor_loss_5yrs", "Has the applicant had a liquor loss in the last 5 years?", { required: false, showIf: liquorSold }),
        {
          type: "textarea",
          id: "liquor_loss_details",
          label: "Please Describe (Has the applicant had a liquor loss in the last 5 years?)",
          showIf: (v) => liquorSold(v) && is("liquor_loss_5yrs", "Yes")(v),
        },
      ],
    },
    {
      id: "prior_insurance",
      title: "Prior Insurance Experience",
      fields: [
        {
          type: "content",
          id: "loss_experience_note",
          variant: "info",
          body: "Please fax, mail or email premium and loss experience for the past 5 years to (720) 836-6399.",
        },
        { type: "textarea", id: "losses_over_5000", label: "Please describe any losses over $5,000.00:" },
        yesNo("event_held_before", "Has this event been held in the past by the applicant?", { required: false }),
        num("event_held_years", "For how many years?", { width: "half", showIf: isYes("event_held_before") }),
        yesNo("prior_cancelled", "Has your prior insurance ever been cancelled?"),
        yesNo("prior_non_renewed", "Has your prior insurance ever refused to renew?"),
        yesNo("risk_management_plan", "Do you have a Risk Management Plan?"),
        {
          type: "content",
          id: "documents_note",
          variant: "info",
          body: "Please fax to (720) 836-6399, mail, or email all Lease and Hold Harmless Agreements, brochures of the event and a diagram of location(s) to be used.",
        },
      ],
    },
    {
      id: "additional_insured",
      title: "Additional Insured",
      description: "Leave blank if you don't need an additional insured.",
      fields: [...additionalInsuredFields(1), ...additionalInsuredFields(2)],
    },
    {
      id: "signature",
      title: "Additional Information & Digital Signature",
      fields: [
        text("referral_source", "How did you hear about us?", { required: true }),
        {
          type: "content",
          id: "representations",
          variant: "notice",
          body: [
            "Any person who knowingly presents a false or fraudulent claim for payment of a loss or benefit or knowingly provides false information in an application for insurance may be guilty of a crime and may be subject to civil fines and criminal penalties. I certify that the above information is true and coverage is not in force until accepted by Anthony Insurance Services, Inc. Coverage is subject to the receipt of payment of the required premium by Anthony Insurance Services, Inc.",
            "Coverage will begin on the date of acceptance or on the date requested, whichever is later. I understand that the premium is fully earned upon policy inception.",
          ],
        },
        { type: "signature", id: "signature", label: "Authorized Electronic Signature", required: true },
      ],
    },
  ],
};
