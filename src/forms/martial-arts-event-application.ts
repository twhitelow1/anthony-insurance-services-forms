import { isYes, money, num, opts, text, US_STATES, yesNo } from "@/lib/forms/helpers";
import type { Field, FormDefinition } from "@/lib/forms/types";

/**
 * Martial Arts Single Event Insurance Application.
 * Transcribed from the Lead Alchemist survey Bt8KGBOGa5n7THVJuqsY embedded on
 * martialartsschoolinsurance.com/martial-arts-event-insurance-application/.
 */

function additionalInsuredFields(n: number): Field[] {
  return [
    { type: "content", id: `ai_${n}_heading`, title: `Additional Insured ${n}`, variant: "subheading" },
    text(`ai_${n}_name`, "Additional Insured Name"),
    text(`ai_${n}_address`, "Street Address"),
    text(`ai_${n}_city`, "City", { width: "third" }),
    { type: "select", id: `ai_${n}_state`, label: "State", options: US_STATES, width: "third" },
    text(`ai_${n}_zip`, "ZIP Code", { width: "third" }),
    text(`ai_${n}_relationship`, "Relationship", { placeholder: "e.g. venue of event" }),
  ];
}

export const martialArtsEventApplication: FormDefinition = {
  slug: "martial-arts-event-application",
  title: "Martial Arts Single Event Insurance Application",
  subtitle: "Accident & General Liability or Spectator / Premise Only coverage for a martial arts event or tournament",
  tags: ["form:martial-arts-event-application", "martial-arts"],
  source: "Anthony Insurance Forms — Martial Arts Single Event Insurance Application",
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
        { type: "content", id: "address_heading", variant: "subheading", title: "Address" },
        text("mailing_address", "Mailing Address", { required: true, ghl: { standard: "address1" } }),
        text("mailing_city", "City", { required: true, width: "third", ghl: { standard: "city" } }),
        { type: "select", id: "mailing_state", label: "State", options: US_STATES, required: true, width: "third", ghl: { standard: "state" } },
        text("mailing_postal_code", "Postal code", { required: true, width: "third", ghl: { standard: "postalCode" } }),
        text("last_name", "Last Name", { required: true, width: "half", ghl: { standard: "lastName" } }),
        text("first_name", "First Name", { required: true, width: "half", ghl: { standard: "firstName" } }),
        { type: "tel", id: "phone", label: "Phone", required: true, width: "half", ghl: { standard: "phone" } },
        { type: "email", id: "email", label: "Email", required: true, width: "half", ghl: { standard: "email" } },
        { type: "url", id: "website", label: "Organization / Event Website", placeholder: "www.example.com", ghl: { standard: "website" } },
      ],
    },
    {
      id: "event_details",
      title: "Event Details",
      fields: [
        text("event_name", "Name of Event", { required: true }),
        text("event_type", "Event Type", { required: true }),
        {
          type: "content",
          id: "coverage_dates_heading",
          variant: "subheading",
          title: "Desired coverage date (including setup and tear down):",
        },
        { type: "date", id: "requested_effective_date", label: "Start Date", required: true, width: "half" },
        { type: "date", id: "coverage_end_date", label: "End Date", required: true, width: "half" },
        money("estimated_gross_receipts", "Estimated Gross Receipts", { required: true, width: "half" }),
        {
          type: "textarea",
          id: "event_description",
          label: "Description of Event",
          required: true,
          tooltip:
            "Please provide a detailed list of all activities to be held or what will take place for the duration of your event to ensure your event is quoted properly and returned promptly.",
        },
        {
          type: "radio",
          id: "policy_type",
          label: "Please select one of the following:",
          options: opts(
            "I would like to purchase an Accident & General Liability Policy (i.e. includes Participant Liability which covers claims and medical bills of an injured athletic participant)",
            "I would like to purchase a Spectator / Premise Only policy (i.e. Provides General Liability coverage for use premise and against claims made by spectators. Claims made by ATHLETIC PARTICIPANTS are EXCLUDED.)",
          ),
          required: true,
        },
      ],
    },
    {
      id: "insurance_details",
      title: "Insurance Details",
      fields: [
        text("event_level", "Event Level", { required: true, width: "half" }),
        text("sport_activity", "Sport Activity", {
          required: true,
          width: "half",
          tooltip: "List the sport(s) to be covered at the event.",
        }),
        num("youth_participants", "Total number of YOUTH Participants", { required: true, width: "half", hint: "18 and under." }),
        num("adult_participants", "Total number of ADULT Participants", { required: true, width: "half", hint: "19 and up." }),
        num("tournament_team_count", "If this is a tournament, total number of teams:", {
          width: "half",
          max: 300,
          hint: "Please enter a number less than or equal to 300.",
        }),
        num("spectators_per_day", "Estimated Number of Spectators Per Day", { width: "half" }),
        {
          type: "textarea",
          id: "race_distances",
          label: "If activity is a race type activity, please provide distances for each race activity:",
        },
        { type: "radio", id: "race_obstacles", label: "Does race include obstacles?", options: opts("Yes", "No") },
        {
          type: "textarea",
          id: "obstacles_description",
          label: "Please upload description of obstacles here",
          tooltip:
            "If yes, a full list of the obstacles will be required before a quote will be released. Please upload description of obstacles here",
          hint: "Describe the obstacles here, or email the full list to your agent.",
          showIf: isYes("race_obstacles"),
        },
        yesNo("participants_overnight", "Does your event have participants staying overnight?"),
        {
          type: "textarea",
          id: "participants_overnight_details",
          label: "Please Describe (Participants are staying overnight)",
          showIf: isYes("participants_overnight"),
        },
        { type: "content", id: "event_location_heading", variant: "subheading", title: "Event Location Address" },
        text("event_street", "Street Address", { required: true }),
        text("event_city", "City", { required: true, width: "third" }),
        { type: "select", id: "event_state", label: "State", options: US_STATES, required: true, width: "third" },
        text("event_zip", "ZIP Code", { required: true, width: "third" }),
        {
          type: "textarea",
          id: "additional_locations",
          label: "If more than one location, please provide additional locations here:",
        },
        yesNo("waiver_system", "Do you utilize a waiver system?", {
          hint: "Need a copy of a waiver? https://martialartsschoolinsurance.com/wp-content/uploads/2026/05/Sporting_Event_Waiver_Template-MASI.pdf",
        }),
        yesNo("risk_management_plan", "Do you have a Risk Management Plan?", {
          tooltip:
            "A risk management plan includes your organization’s written safety procedures—such as an emergency action plan, weather-incident steps, injury/incident report forms, and posted safety rules. You should have these in place or be ready to adopt them at the start of the policy.",
        }),
        yesNo("prior_coverage_cancelled", "Has prior coverage been cancelled or non-renewed?"),
        {
          type: "textarea",
          id: "prior_coverage_cancelled_details",
          label: "Please Describe (Prior coverage been cancelled or non-renewed)",
          showIf: isYes("prior_coverage_cancelled"),
        },
        {
          type: "radio",
          id: "liability_limit",
          label: "Liability Insurance Limit Requested",
          options: opts("$1 Million", "$2 Million", "$3 Million", "$4 Million", "$5 Million"),
          required: true,
        },
        {
          type: "radio",
          id: "accident_medical_limit",
          label: "Accident Medical Limits Requested",
          options: opts("None", "$10,000.00", "$25,000.00", "$50,000.00", "$100,000.00"),
          required: true,
        },
      ],
    },
    {
      id: "additional_insured",
      title: "Additional Insured",
      description: "Leave blank if you don't need an additional insured.",
      fields: [
        {
          type: "content",
          id: "ai_info",
          variant: "info",
          body: "Enter in the name and address of the Additional Insured (i.e. the venue of your event) and type in how this Additional Insured is related to your policy (i.e. venue of event)",
        },
        ...[1, 2].flatMap(additionalInsuredFields),
      ],
    },
    {
      id: "signature",
      title: "Additional Information & Digital Signature",
      fields: [
        text("how_did_you_hear", "How did you hear about us?", { required: true }),
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
