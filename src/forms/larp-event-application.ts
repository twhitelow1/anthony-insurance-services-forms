import { isYes, num, opts, text, US_STATES, yesNo } from "@/lib/forms/helpers";
import type { Field, FormDefinition, FormValues } from "@/lib/forms/types";

/**
 * Live Action Role Playing (LARP) — Specialty Insurance Coverage application.
 * Transcribed from the carrier PDF LARP-2026-AIS.pdf, in PDF order and grouped by its sections.
 * Premium calculator lines (rate per person, calculated/total premiums, subtotals, broker fee,
 * total amount due) are computed by the agent and are not applicant questions, so they are omitted.
 */

const RELATIONSHIP_OPTIONS = opts(
  "L - Landlord",
  "V - Venue",
  "E - Event Operator",
  "F - Franchisor/Franchise Owner",
  "G - Governmental Agency",
  "O - Other (include details)",
);

function additionalInsuredFields(n: number): Field[] {
  const isOther = (v: FormValues) => v[`ai_${n}_relationship`] === "O - Other (include details)";
  return [
    { type: "content", id: `ai_${n}_heading`, title: `Additional Insured #${n}`, variant: "subheading" },
    text(`ai_${n}_name`, "Full Legal Name", { width: "half" }),
    { type: "email", id: `ai_${n}_email`, label: "Email Address", width: "half" },
    text(`ai_${n}_address`, "Full Mailing Address (including city, state, zip)"),
    {
      type: "select",
      id: `ai_${n}_relationship`,
      label: "Relationship (see legend)",
      options: RELATIONSHIP_OPTIONS,
      width: "half",
    },
    text(`ai_${n}_relationship_details`, "Other relationship details", { required: true, width: "half", showIf: isOther }),
    {
      type: "checkboxes",
      id: `ai_${n}_endorsements`,
      label: "Endorsements",
      options: opts("Primary", "Waiver"),
      tooltip:
        "Primary = Additional Insured requiring a Primary Non-Contributory Endorsement (x $100.00). Waiver = Additional Insured requiring a Waiver of Subrogation Endorsement (x $100.00).",
    },
  ];
}

export const larpEventApplication: FormDefinition = {
  slug: "larp-event-application",
  title: "Live Action Role Playing Insurance Application",
  subtitle: "Specialty Insurance Coverage for Live Action Role Playing — Accident and General Liability",
  tags: ["form:larp-event-application", "special-event"],
  source: "Anthony Insurance Forms — Live Action Role Playing Insurance Application",
  successMessage:
    "Thank you! Your application has been submitted. An Anthony Insurance Services agent will review it and reach out shortly.",
  sections: [
    {
      id: "policyholder",
      title: "Proposed Policyholder Information",
      fields: [
        {
          type: "content",
          id: "instructions",
          title: "Instructions",
          variant: "info",
          body: [
            "Policy will become effective on the Requested Effective Date if (a) all required information is provided and (b) the Company has received the initial premium on or before that date.",
            "12 months of coverage is provided.",
          ],
        },
        text("legal_business_name", "Full Legal Name of Proposed Policyholder", {
          required: true,
          ghl: { standard: "companyName" },
        }),
        { type: "content", id: "contact_heading", variant: "subheading", title: "Contact Name" },
        text("first_name", "First Name", { required: true, width: "half", ghl: { standard: "firstName" } }),
        text("last_name", "Last Name", { required: true, width: "half", ghl: { standard: "lastName" } }),
        { type: "tel", id: "phone", label: "Phone Number", required: true, width: "half", ghl: { standard: "phone" } },
        { type: "date", id: "requested_effective_date", label: "Requested Effective Date", required: true, width: "half" },
        { type: "email", id: "email", label: "Email Address", required: true, ghl: { standard: "email" } },
        text("mailing_address", "Full Mailing Address", { required: true, ghl: { standard: "address1" } }),
        text("mailing_city", "City", { required: true, width: "third", ghl: { standard: "city" } }),
        { type: "select", id: "mailing_state", label: "State", options: US_STATES, required: true, width: "third", ghl: { standard: "state" } },
        text("mailing_postal_code", "Zip", { required: true, width: "third", ghl: { standard: "postalCode" } }),
        {
          type: "radio",
          id: "type_of_operation",
          label: "Type of Operation",
          options: opts(
            "Corporation",
            "Individual/Sole Proprietor",
            "Partnership/Joint Venture",
            "Limited Liability Company (LLC)",
            "Other",
          ),
          required: true,
        },
        text("type_of_operation_other", "Other:", { required: true, showIf: (v) => v.type_of_operation === "Other" }),
      ],
    },
    {
      id: "accident_coverage",
      title: "Accident Coverage",
      description: "Accident Coverage Premium Rate Calculator. Minimum Premium is Fully Earned Upon Policy Inception.",
      fields: [
        num("youth_participants", "Number of Youth Participants", {
          required: true,
          width: "half",
          hint: "Youth (age under 18)",
        }),
        num("adult_participants", "Number of Adult Participants", {
          required: true,
          width: "half",
          hint: "Adult (18 and over)",
        }),
      ],
    },
    {
      id: "gl_questionnaire",
      title: "General Liability Questionnaire",
      fields: [
        yesNo("past_coverage_canceled", "1. Has your past liability coverage been canceled in any way in the last three years?"),
        yesNo("waiver_system", "2. Does your organization currently utilize a waiver system?"),
        yesNo("risk_management_plan", "3. Does your organization currently have a risk management plan?"),
        yesNo("insurer_non_renewing", "4. Is your current insurer non-renewing coverage?"),
        yesNo("claims_paid_3yrs", "5. Have any liability claims been paid by your insurer during the last 3 years?"),
        {
          type: "textarea",
          id: "claims_description",
          label: "If yes, please describe claims:",
          required: true,
          showIf: isYes("claims_paid_3yrs"),
        },
        yesNo("facilities_24_hour", "6. Do you own or operate any sports fields, courts or facilities on a 24-hour basis?"),
        yesNo("players_compensated", "7. Are any of your players compensated/paid to participate in your organization?"),
        yesNo("school_sanctioned", "8. Is your organization school-sanctioned?"),
        yesNo("residential_property", "9. Are any activities held on residential property?"),
        yesNo("pool_activities", "10. Do any activities take place at a pool that you own, operate or manage?"),
      ],
    },
    {
      id: "gl_coverage",
      title: "General Liability Coverage",
      description:
        "General Liability Coverage Premium Rate Calculator. Minimum Premium is Fully Earned Upon Policy Inception. Rates include $1,000,000 Per Occurrence / $1,000,000 Aggregate General Liability Policy.",
      fields: [
        {
          type: "radio",
          id: "gl_aggregate",
          label: "General Liability Aggregate",
          options: opts("$1,000,000", "$2,000,000", "$3,000,000", "$4,000,000", "$5,000,000"),
          required: true,
        },
        num("total_participants", "Total Number of Participants", { required: true, width: "half" }),
      ],
    },
    {
      id: "optional_coverages",
      title: "Optional Coverages",
      description: "Premiums are fully earned.",
      fields: [
        {
          type: "content",
          id: "optional_underwriting_info",
          variant: "info",
          body: [
            "The following optional coverages are also available but subject to additional underwriting: $1,000,000 Abuse or Molestation Liability Coverage, $1,000,000 Hired and Non-Owned Automobile Liability Coverage, Equipment Coverage up to $750,000, Excess Liability Coverage of up to $4,000,000.",
            "Please contact your agent. Download Abuse Questionnaire",
          ],
        },
        {
          type: "radio",
          id: "hired_non_owned_auto",
          label: "Hired and non-owned automobile liability coverage",
          options: opts("$250,000 for an additional $250.00", "$500,000 for an additional $500.00", "No, thank you."),
          required: true,
          hint: "12 or 15 plus passenger vans are ineligible for this program.",
        },
        {
          type: "radio",
          id: "abuse_molestation",
          label: "Abuse or Molestation Liability Coverage",
          options: opts("$100,000 / $300,000 for an additional $1000.00", "No, thank you."),
          required: true,
        },
        {
          type: "radio",
          id: "medical_payment",
          label: "Medical Payment",
          options: opts("$10,000 for an additional percentage of Liability Premium", "No, thank you."),
          required: true,
        },
      ],
    },
    {
      id: "additional_insureds",
      title: "Additional Insureds",
      description: "Standard Additional insureds are included at no additional cost. Leave blank if none.",
      fields: [
        {
          type: "content",
          id: "ai_info",
          variant: "info",
          body: [
            "Name, Address and Relationship of all additional insureds to be added to the policy. If you need more room, email additional pages to your agent.",
            "Relationship legend: L - Landlord, V - Venue, E - Event Operator, F - Franchisor/Franchise Owner, G - Governmental Agency, O - Other (include details).",
            "Additional Insureds requiring Primary Non-Contributory Endorsements x $100.00. Additional Insureds requiring Waiver of Subrogation Endorsements x $100.00.",
          ],
        },
        ...[1, 2, 3].flatMap(additionalInsuredFields),
      ],
    },
    {
      id: "payment",
      title: "Payment",
      fields: [
        {
          type: "radio",
          id: "payment_enclosed",
          label: "Enclosed is:",
          options: opts("my payment for the total premium", "20% of my total premium"),
          required: true,
          hint: "Total Amount Due includes the FLD Broker Fee.",
        },
        {
          type: "radio",
          id: "payment_method",
          label: "Payment method:",
          options: opts("Credit Card", "ACH"),
          required: true,
        },
      ],
    },
    {
      id: "signature",
      title: "Acknowledgments and Signatures",
      fields: [
        {
          type: "content",
          id: "excluded_activities",
          variant: "notice",
          title: "Excluded Activities",
          body: "The ownership, operation, maintenance arising out of the use of inflatable recreational devices or inflatable amusement devices of any kind. Any use, event or display arising out of fireworks, or any other use of pyrotechnics including any firework sales. Any use, handling, training, or storage of any firearms, ammunition, or explosives. Any operations involving bungee devices (except for indoor bungee fitness), carnival rides, corn cannons, organized equine racing contests, organized equine vaulting or jumping contests, leasing of horses, jumping pillows, knocker ball, bubble soccer, Zorb ball, mechanical bucking devices including multi-ride attachments, aerial activities above 12 feet, rock climbing activities, activities involving permanent or mobile rock wall climbing structures, zip lines, pumpkin launching devices, rope challenge courses, water skiing, surfing, white water rafting or kayaking, tackle football, ATV/UTV, tracked or trackless train rides, trampolines, bike related trick or stunt activities or contests, Zippy Pets, haunted houses, haunted trails or haunted boats or barges, demolition derbies of any kind, independent security services other than a contracted public law enforcement officer. Trail design, including trail construction and maintenance, Participants of Mixed Martial Arts (MMA) competitions or tournaments, Participants of boxing competitions or tournaments, Participants of bare-knuckle boxing, Any use of sharpened or live edged weapons, Security Officers Registration Act (SORA) training programs, WWE style fight training, professional fight training, professional fighting participants, Operations of independent concessionaires or vendors in conjunction with your organization or event, Operations of independent performers and artists in conjunction with your organization or event, Use of gymnastics apparatuses, including balance beams, uneven bars, vaults, spring flooring, and rings, Aerial activities and performances other than studio sponsored recitals with maximum heights of 12 feet.",
        },
        {
          type: "content",
          id: "representations",
          variant: "notice",
          body: [
            "a. This summary of coverage and exclusions is no substitute for reading the entire policy. To receive an entire policy, contact the program administrator.",
            "b. Waiver Requirement — Each organization or team must implement a Release and Waiver of Liability and Indemnity Agreement for all players and staff. Unintentional error on your part in securing Waiver and Release forms shall not void your coverage in the event of an occurrence to a player or staff member. However, your failure to maintain an adequate system to regularly secure Waiver and Release forms shall void your coverage in the event of an occurrence to a player or staff member. A sample waiver and release form is available upon request.",
            "c. Fraud Warning — Any person who knowingly and with intent to defraud any insurance company or other person files an application for insurance or statement of claim containing any materially false information, or conceals for the purpose of misleading, information concerning any fact material there to, commits a fraudulent insurance act, which may be a crime.",
            "d. Applicant’s Acknowledgement — I, the applicant, declare, to the best of my knowledge and belief, that all statements and answers in this application are true and complete. I understand and agree that (a) this application will form part of any policy issued, (b) no information given to or acquired by any representative of the Company will bind it, unless it is in writing on this application, (c) no waiver or modification will bind the Company unless it is in writing and is signed by an executive officer of the Company, and (d) only those persons eligible under the terms of an issued policy will be insured.",
          ],
        },
        { type: "signature", id: "signature", label: "Signed for the Proposed Policyholder", required: true },
        { type: "date", id: "signature_date", label: "Date", required: true, width: "half" },
      ],
    },
  ],
};
