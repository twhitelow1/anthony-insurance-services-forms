import { isYes, num, opts, text, US_STATES, yesNo } from "@/lib/forms/helpers";
import type { Field, FormDefinition } from "@/lib/forms/types";

/**
 * Sport Event Insurance Application — martial arts tournaments, sports teams/leagues
 * and sports events/tournaments.
 * Transcribed from the Lead Alchemist form pkfFEJ14mVIBrytwX7g5
 * (older website version: anthonyinsuranceservices.com/forms/sport-event-insurance-application/).
 *
 * Answers are stored in the app's database. Only fields with `ghl.standard`
 * are copied to the Lead Alchemist contact.
 */

function additionalInsured(n: 1 | 2): Field[] {
  const suffix = n === 1 ? "" : " #02";
  const p = `ai_${n}`;
  return [
    {
      type: "content",
      id: `${p}_heading`,
      variant: "subheading",
      title: n === 1 ? "Additional Insured" : "Insured #02",
    },
    text(`${p}_name`, `Insured Name${suffix}`),
    text(`${p}_address`, `Insured Street Address${suffix}`),
    text(`${p}_city`, `Insured City${suffix}`, { width: "third" }),
    { type: "select", id: `${p}_state`, label: `Insured State${suffix}`, options: US_STATES, width: "third" },
    text(`${p}_zip`, `Insured ZIP Code${suffix}`, { width: "third" }),
    text(`${p}_relationship`, `Insured Relationship${suffix}`),
  ];
}

export const sportEventApplication: FormDefinition = {
  slug: "sport-event-application",
  title: "Sport Event Insurance Application",
  subtitle: "Liability and accident coverage for tournaments, teams, leagues and sports events",
  tags: ["form:sport-event-application", "sports"],
  source: "Anthony Insurance Forms — Sport Event Insurance Application",
  successMessage:
    "Thank you! Your application has been submitted. An Anthony Insurance Services agent will review it and reach out shortly.",
  sections: [
    {
      id: "policyholder",
      title: "Contact & Event Information",
      fields: [
        { type: "content", id: "policyholder_heading", variant: "subheading", title: "Policyholder Information" },
        text("legal_business_name", "Name of Policyholder", {
          required: true,
          tooltip:
            "The name of the business/organization purchasing the insurance; as it will appear on the policy documents and/or other contract or rental agreements.",
          ghl: { standard: "companyName" },
        }),
        { type: "content", id: "address_heading", variant: "subheading", title: "Address" },
        text("mailing_address", "Street Address", { required: true, ghl: { standard: "address1" } }),
        text("mailing_city", "City", { required: true, width: "third", ghl: { standard: "city" } }),
        {
          type: "select",
          id: "mailing_state",
          label: "State",
          options: US_STATES,
          required: true,
          width: "third",
          ghl: { standard: "state" },
        },
        text("mailing_postal_code", "Postal Code", { required: true, width: "third", ghl: { standard: "postalCode" } }),
        { type: "content", id: "contact_heading", variant: "subheading", title: "Contact Name" },
        text("first_name", "First Name", { required: true, width: "half", ghl: { standard: "firstName" } }),
        text("last_name", "Last Name", { required: true, width: "half", ghl: { standard: "lastName" } }),
        { type: "tel", id: "phone", label: "Phone", required: true, width: "half", ghl: { standard: "phone" } },
        { type: "email", id: "email", label: "Email", required: true, width: "half", ghl: { standard: "email" } },
        {
          type: "url",
          id: "website",
          label: "Organization / Event Website",
          placeholder: "www.example.com",
          ghl: { standard: "website" },
        },
      ],
    },
    {
      id: "event",
      title: "Event Details",
      fields: [
        text("event_name", "Name of Event", { required: true }),
        text("event_type", "Event Type", { required: true }),
        {
          type: "content",
          id: "coverage_dates_heading",
          variant: "subheading",
          title: "Date of Event",
          body: "Desired coverage date (including setup and tear down):",
        },
        { type: "date", id: "requested_effective_date", label: "Start Date", required: true, width: "half" },
        { type: "date", id: "event_end_date", label: "End Date", required: true, width: "half" },
        { type: "currency", id: "estimated_gross_receipts", label: "Estimated Gross Receipts", required: true, min: 0, width: "half" },
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
      id: "insurance",
      title: "Insurance Information",
      fields: [
        text("event_level", "Event Level", { required: true, width: "half" }),
        text("sport_activity", "Sport Activity", {
          required: true,
          tooltip: "List the sport(s) to be covered at the event.",
        }),
        num("youth_participants", "Total number of YOUTH Participants", {
          max: 1000,
          width: "half",
          tooltip: "18 and under.",
          hint: "Please enter a number less than or equal to 1000.",
        }),
        num("adult_participants", "Total number of ADULT Participants", {
          required: true,
          max: 1000,
          width: "half",
          tooltip: "19 and up.",
          hint: "Please enter a number less than or equal to 1000.",
        }),
        num("tournament_team_count", "If this is a tournament, total number of teams:", {
          max: 300,
          width: "half",
          hint: "Please enter a number less than or equal to 300.",
        }),
        num("spectators_per_day", "Estimated Number of Spectators Per Day", {
          max: 1000,
          width: "half",
          hint: "Please enter a number less than or equal to 1000.",
        }),
        {
          type: "textarea",
          id: "race_distances",
          label: "If activity is a race type activity, please provide distances for each race activity:",
        },
        yesNo("race_obstacles", "Does race include obstacles?", { required: false }),
        {
          type: "content",
          id: "race_obstacles_notice",
          variant: "info",
          body: "If yes, a full list of the obstacles will be required before a quote will be released. Please upload description of obstacles here or email to: Caitlyn@AnthonyInsuranceServices.com",
        },
        {
          type: "textarea",
          id: "race_obstacles_description",
          label: "Description of obstacles",
          showIf: isYes("race_obstacles"),
        },
        yesNo("overnight_participants", "Does your event have participants staying overnight?"),
        {
          type: "textarea",
          id: "overnight_description",
          label: "Please Describe",
          showIf: isYes("overnight_participants"),
        },
        { type: "content", id: "event_location_heading", variant: "subheading", title: "Event Location" },
        text("event_street_address", "Event Street Address", { required: true }),
        text("event_city", "Event City", { required: true, width: "third" }),
        { type: "select", id: "event_state", label: "Event State", options: US_STATES, required: true, width: "third" },
        text("event_zip", "Event ZiP Code", { required: true, width: "third" }),
        {
          type: "textarea",
          id: "additional_locations",
          label: "If more than one location, please provide additional locations here:",
        },
        yesNo("waiver_system", "Do you utilize a waiver system?", {
          hint: "Need a copy of a waiver? https://anthonyinsuranceservices.com/wp-content/uploads/2014/03/ReleaseandWaiver.pdf",
        }),
        yesNo("risk_management_plan", "Do you have a Risk Management Plan?", {
          hint: "If you do not yet have such a plan in place, see our Guide to Risk Management: https://anthonyinsuranceservices.com/wp-content/uploads/2014/03/GuideToRiskManagement.pdf",
        }),
        yesNo("prior_cancelled", "Has prior coverage been cancelled or non-renewed?"),
        {
          type: "textarea",
          id: "prior_cancelled_details",
          label: "Please Describe the Cancellation or Non-Renewal",
          showIf: isYes("prior_cancelled"),
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
          tooltip: "A minimum accident limit of $10,000 is required if participant liability coverage is desired.",
        },
      ],
    },
    {
      id: "additional_insured",
      title: "Additional Insured",
      description: "Leave blank if you don't need an additional insured.",
      fields: [...additionalInsured(1), ...additionalInsured(2)],
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
