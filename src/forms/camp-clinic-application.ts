import { isYes, num, opts, text, US_STATES, yesNo } from "@/lib/forms/helpers";
import type { Field, FormDefinition, FormValues } from "@/lib/forms/types";

/**
 * Camp / Clinic Insurance Application.
 * Transcribed from the Lead Alchemist (GHL) form okKpbcPIEgUykRJQy2QE
 * (older website version: anthonyinsuranceservices.com/forms/camp-clinic-insurance-application/).
 *
 * Answers are stored in the app's database. Only fields with `ghl.standard`
 * are copied to the GoHighLevel contact.
 */

const sessionCount = (v: FormValues) => Number(v.session_count ?? 0);

function sessionFields(n: number): Field[] {
  const showIf = (v: FormValues) => sessionCount(v) >= n;
  const suffix = n === 1 ? "" : ` ${n}`;
  return [
    { type: "content", id: `session_${n}_heading`, title: `Session ${n}`, variant: "subheading", showIf },
    text(`session_${n}_name`, `Camp / Clinic${n === 1 ? "" : " Session" + suffix}`, { required: true, showIf }),
    { type: "date", id: `session_${n}_date`, label: `Date – Camp / Clinic${n === 1 ? "" : " Session" + suffix}`, required: true, showIf, width: "half" },
    text(`session_${n}_duration`, `Duration – Camp / Clinic Session${suffix}`, { required: true, showIf, width: "half" }),
    num(`session_${n}_youth`, `Number of Youth Participants – Camp / Clinic Session${suffix}`, { required: true, showIf, width: "half" }),
    num(`session_${n}_adult`, `Number of Adult Participants – Camp / Clinic Session${suffix}`, { required: true, showIf, width: "half" }),
  ];
}

function additionalInsured(n: 1 | 2): Field[] {
  const suffix = n === 1 ? "" : " #02";
  const p = `ai_${n}`;
  return [
    { type: "content", id: `${p}_heading`, variant: "subheading", title: `Additional Insured${n === 1 ? "" : " #02"}` },
    text(`${p}_name`, `Insured Name${suffix}`),
    text(`${p}_address`, `Insured Street Address${suffix}`),
    text(`${p}_city`, `Insured City${suffix}`, { width: "third" }),
    { type: "select", id: `${p}_state`, label: `Insured State${suffix}`, options: US_STATES, width: "third" },
    text(`${p}_zip`, `Insured ZIP Code${suffix}`, { width: "third" }),
    text(`${p}_relationship`, `Insured Relationship${suffix}`),
  ];
}

export const campClinicApplication: FormDefinition = {
  slug: "camp-clinic-application",
  title: "Camp / Clinic Insurance Application",
  subtitle: "Liability and accident coverage for sports camps and clinics",
  tags: ["form:camp-clinic-application", "sports"],
  source: "Anthony Insurance Forms — Camp / Clinic Insurance Application",
  successMessage:
    "Thank you! Your application has been submitted. An Anthony Insurance Services agent will review it and reach out shortly.",
  sections: [
    {
      id: "policyholder",
      title: "Contact & Event Information",
      fields: [
        { type: "content", id: "policyholder_heading", variant: "subheading", title: "Policyholder Information" },
        text("legal_business_name", "Organization Name", {
          required: true,
          tooltip: "As it will appear on Policy Documents.",
          ghl: { standard: "companyName" },
        }),
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
        { type: "content", id: "address_heading", variant: "subheading", title: "Address" },
        text("mailing_address", "Street Address", { required: true, ghl: { standard: "address1" } }),
        text("mailing_city", "City", { required: true, width: "half", ghl: { standard: "city" } }),
        {
          type: "select",
          id: "mailing_state",
          label: "State",
          options: US_STATES,
          required: true,
          width: "half",
          ghl: { standard: "state" },
        },
        text("mailing_country", "Country", { required: true, width: "half", placeholder: "United States" }),
        text("mailing_postal_code", "Postal Code", { required: true, width: "half", ghl: { standard: "postalCode" } }),
      ],
    },
    {
      id: "coverage",
      title: "Coverage Details",
      fields: [
        text("camp_name", "Name of Camp / Clinic", { required: true }),
        {
          type: "date",
          id: "requested_effective_date",
          label: "Desired Effective Date",
          required: true,
          width: "half",
          tooltip: "Camp and Clinic session dates will be obtained later in the application process.",
        },
        { type: "date", id: "desired_expiration_date", label: "Desired Expiration Date", required: true, width: "half" },
        {
          type: "textarea",
          id: "non_sport_activities",
          label: "List all non-sport activities offered at camp/clinic:",
          required: true,
          hint: "Non-sports Only.",
        },
        {
          type: "textarea",
          id: "sport_activities",
          label: "List all sports activities to be covered at camp/clinic:",
          required: true,
          hint: "Sports Only.",
        },
        {
          type: "textarea",
          id: "typical_session",
          label: "Describe a typical camp session. What will the participants be doing during the covered camp/clinic?",
        },
        {
          type: "content",
          id: "eligibility_notice",
          variant: "notice",
          body: [
            "PLEASE NOTE: Before/After School Programs, Camps with Horseback Riding, Camps with Amusement Park or Water Park exposures, Sport Instruction Facilities & Adult Soccer Tournaments are excluded unless approved by carrier. Additional underwriting will apply.",
            "PLEASE NOTE INELIGIBLE ACTIVITY TYPES: High Ropes Courses, Zip Lines, Trampolines, Mechanical Bulls, Rock Climbing, Firearms/Riflery, White Water Rafting, Gymnastics, Jet Skis, Motorized Boats, ATVs, Water Skiing/Boarding, Fire Dancing, Bungee Jumping and Activities outside of the U.S. are not eligible for coverage.",
          ],
        },
        {
          type: "select",
          id: "session_count",
          label: "How many camp sessions do you want to cover?",
          options: opts("1", "2", "3", "4", "5"),
          required: true,
          width: "half",
          tooltip: "Please enter the details for each individual Camp or Clinic session separately.",
          hint: "Select the number of Camp / Clinic sessions to display the required fields below.",
        },
        ...[1, 2, 3, 4, 5].flatMap(sessionFields),
        yesNo("overnight_participants", "Does your camp/clinic participants staying overnight?:", { required: false }),
        {
          type: "textarea",
          id: "overnight_description",
          label: "Please Describe",
          showIf: isYes("overnight_participants"),
        },
      ],
    },
    {
      id: "liability",
      title: "Liability Questionnaire",
      fields: [
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
          hint: "A minimum accident limit of $10,000 is required if participant liability coverage is desired.",
        },
        {
          type: "checkboxes",
          id: "accident_medical_deductible",
          label: "Select Accidental Medical Deductible",
          options: opts("$100", "$250", "$500", "$1,000", "$2,500"),
          hint: "Check deductible option(s) you would like included in your quote.",
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
      id: "additional_info",
      title: "Additional Information",
      fields: [
        text("how_did_you_hear", "How did you hear about us?", { required: true }),
        {
          type: "content",
          id: "optional_coverages_heading",
          variant: "subheading",
          title: "Optional Coverage's (Premiums are fully earned at inception)",
        },
        {
          type: "radio",
          id: "hnoa_coverage",
          label: "Hired and Non-Owned Automobile Liability Coverage.",
          options: opts(
            "None",
            "$150,000 Limit (additional premium = $225.00)",
            "$500,000 Limit (additional premium = $500.00)",
          ),
          hint: "$1,000,000.00 Hired and Non-Owned Automobile Liability Coverage is available but subject to additional underwriting. Please contact your agent if wishing to apply for coverage.",
        },
        {
          type: "radio",
          id: "sexual_abuse_coverage",
          label: "Sexual Abuse and Molestation Liability Coverage",
          options: opts("None", "$100,000 Limit (additional premium = $1,000.00)"),
        },
        {
          type: "radio",
          id: "medical_expense_benefit",
          label: "Medical Expense Benefit",
          options: opts("None", "$5,000 Limit (additional premium = $5,000)"),
          tooltip:
            "Medical Expense Coverage pays for costs incurred by an individual on your premise who is not an athletic participant (i.e. parent of child, postal service worker, etc.) regardless of who is at fault.",
        },
        {
          type: "content",
          id: "equipment_coverage",
          variant: "info",
          title: "Equipment Coverage",
          body: "Equipment Coverage is available but subject to additional underwriting. To request a quote, please submit an online application. The following link will take you to the Equipment Coverage Application: Equipment Coverage",
        },
      ],
    },
    {
      id: "signature",
      title: "Acknowledgement & Signatures",
      fields: [
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
