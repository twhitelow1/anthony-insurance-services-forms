import { isYes, money, num, opts, text, US_STATES, yesNo } from "@/lib/forms/helpers";
import type { Field, FormDefinition, FormValues } from "@/lib/forms/types";

/**
 * Fitness Class & Cross Training Facilities application (used for yoga studios, pilates studios and health clubs).
 * Transcribed from the carrier PDF "Specialty Insurance Coverage for Fitness Class and Cross Training Facilities"
 * (FORM: CTF REV 2/28/2023):
 * https://dancestudioinsurance.com/wp-content/uploads/2023/05/Fitness-and-Cross-Training-Facilities-DSI_App-Only.pdf
 *
 * The PDF's automated premium calculator fields (rate per participant, minimum premium, totals, broker fee)
 * are calculated by the agency and are not asked here. Card details are collected by the agency, not this form.
 */

const RELATIONSHIPS = opts(
  "L - Landlord",
  "V - Venue",
  "E - Event Operator",
  "F - Franchisor/Franchise Owner",
  "G - Governmental Agency",
  "IC - Independent Contractor (Cost: $75)",
);

function additionalInsuredFields(n: number): Field[] {
  const showIf = n === 1 ? undefined : (v: FormValues) => Boolean(v[`ai_${n - 1}_name`]);
  return [
    { type: "content", id: `ai_${n}_heading`, title: `Additional Insured #${n}`, variant: "subheading", showIf },
    text(`ai_${n}_name`, "Full Legal Name", { width: "half", showIf }),
    { type: "email", id: `ai_${n}_email`, label: "Email Address", width: "half", showIf },
    text(`ai_${n}_address`, "Full Mailing Address (including city, state, zip)", { showIf }),
    { type: "select", id: `ai_${n}_relationship`, label: "Relationship (see legend)", options: RELATIONSHIPS, width: "half", showIf },
    {
      type: "checkboxes",
      id: `ai_${n}_endorsements`,
      label: "Endorsements",
      options: opts("Primary Non-Contributory ($100.00)", "Waiver of Subrogation ($100.00)"),
      width: "half",
      showIf,
    },
  ];
}

export const fitnessFacilityApplication: FormDefinition = {
  slug: "fitness-facility-application",
  title: "Fitness Class & Cross Training Facility Application",
  subtitle: "Specialty liability and accident coverage for fitness, yoga and pilates studios and health clubs",
  tags: ["form:fitness-facility-application", "dance-fitness"],
  source: "Anthony Insurance Forms — Fitness Class & Cross Training Facility Application",
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
        text("legal_business_name", "Full Legal Name of Proposed Policyholder", { required: true, ghl: { standard: "companyName" } }),
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
        text("type_of_operation_other", "Other (please specify)", { required: true, showIf: (v) => v.type_of_operation === "Other" }),
        yesNo("weights_over_50lb", "Does your facility offer use of weights over 50 lb?"),
        yesNo("operating_under_dba", "Are you operating under a doing business as name?"),
        text("dba", "If yes, please enter.", { required: true, showIf: isYes("operating_under_dba") }),
        yesNo("onsite_child_care", "Does your organization provide onsite child care services during fitness classes?"),
        yesNo("tanning_beds", "Does your organization operate tanning bed(s)?"),
        yesNo("spa_massage", "Does your organization provide spa or massage services?"),
        yesNo("sauna", "Is there a sauna on the premises?"),
        yesNo("sports_medicine", "Does your organization provide sports medicine?"),
        yesNo("physical_occupational_therapy", "Does your organization provide physical or occupational therapy?"),
        yesNo("professional_athlete_training", "Does your organization provide professional athlete training?"),
        yesNo(
          "licensed_daycare",
          "Does your organization operate licensed daycare facilities (not child care services for participants during classes)?",
        ),
        yesNo("unsupervised_24_hour", "Does your organization operate any 24 hour facilities with unsupervised or keyed access?"),
      ],
    },
    {
      id: "gl_questionnaire",
      title: "General Liability Questionnaire",
      fields: [
        yesNo("coverage_canceled_3yrs", "Has your past liability coverage been canceled in any way in the last three years?"),
        yesNo("waiver_system", "Does your organization currently utilize a waiver system?"),
        yesNo("risk_management_plan", "Does your organization currently have a risk management plan?"),
        yesNo("insurer_non_renewing", "Is your current insurer non-renewing coverage?"),
        yesNo("claims_paid_3yrs", "Have any liability claims been paid by your insurer during the last 3 years?"),
        { type: "textarea", id: "claims_description", label: "If yes, describe claims:", required: true, showIf: isYes("claims_paid_3yrs") },
        yesNo("safety_training_program", "Does your organization have a formal safety training program for employees?"),
        yesNo("surveillance_cameras", "Does your organization have surveillance cameras?"),
        yesNo("central_station_alarm", "Does your organization have central station fire and burglar alarm?"),
        yesNo("air_supported_structure", "Does your organization include an air supported structure and/or dome?"),
        yesNo("incident_reports", "Are incident reports completed and maintained for all injuries, regardless of severity?"),
        yesNo("playground_equipment", "Does your organization have playground equipment?"),
        money("annual_gross_receipts", "Please enter your Annual Gross Receipt (USD):", { required: true, width: "half" }),
        {
          type: "checkboxes",
          id: "sports_trained",
          label: "What kind of sport do you train? (select all that apply)",
          options: opts(
            "Aerobics",
            "Barre",
            "Boot Camp",
            "Bungee Fitness",
            "Cardio Boxing",
            "Cardio Kickboxing",
            "Circuit Training",
            "CrossCore",
            "Indoor Cycling",
            "High Intensity Interval Training",
            "Jump Rope",
            "Pilates",
            "Spinning",
            "Stretching",
            "Strength Training",
            "T'ai Chi",
            "Total Resistance Exercises",
            "Yoga",
            "Weights",
            "Zumba",
            "Other",
          ),
          required: true,
        },
        text("sports_trained_other", "Other (please specify)", {
          required: true,
          showIf: (v) => Array.isArray(v.sports_trained) && v.sports_trained.includes("Other"),
        }),
      ],
    },
    {
      id: "premium_calculator",
      title: "Premium Rate Calculator",
      fields: [
        {
          type: "content",
          id: "premium_notes",
          variant: "info",
          body: [
            "Minimum Premium is Fully Earned Upon Policy Inception.",
            "Rates Include $100,000 Accident Policy and $1,000,000 Limit Per Occurrence Liability Policy.",
            "Your agent will calculate your premium (rate per participant, minimum premium and totals) from the answers below.",
          ],
        },
        {
          type: "select",
          id: "general_liability_aggregate",
          label: "General Liability Aggregate",
          options: opts("$1,000,000", "$2,000,000", "$3,000,000", "$4,000,000", "$5,000,000"),
          required: true,
          width: "half",
        },
        num("number_of_participants", "Number of Participants", {
          required: true,
          width: "half",
          hint: "Please provide total number of participants in the busiest month of the year.",
        }),
      ],
    },
    {
      id: "optional_coverages",
      title: "Optional Coverages",
      fields: [
        {
          type: "content",
          id: "optional_notes",
          variant: "info",
          body: ["Premiums are fully earned.", "12 or 15 plus passenger vans are ineligible for this program."],
        },
        {
          type: "radio",
          id: "hnoa_coverage",
          label: "Hired and non-owned automobile liability coverage",
          options: opts("$250,000 for an additional $250.00", "$500,000 for an additional $500.00", "No, thank you."),
          required: true,
        },
        {
          type: "radio",
          id: "abuse_molestation_coverage",
          label: "Abuse or Molestation Liability Coverage",
          options: opts("$100,000 / $300,000 for an additional $500.00", "No, thank you."),
          required: true,
        },
        {
          type: "radio",
          id: "medical_payment",
          label: "Medical Payment",
          options: opts("$10,000 for an additional 5% of Your Premium Rate", "No, thank you."),
          required: true,
        },
        {
          type: "content",
          id: "additional_underwriting_coverages",
          variant: "info",
          body:
            "The following optional coverages are also available but subject to additional underwriting: $1,000,000 Abuse or Molestation Liability Coverage, $1,000,000 Hired and Non-Owned Automobile Liability Coverage, Equipment Coverage up to $750,000, higher per occurrence limits of up to $4,000,000. Please contact your agent.",
        },
      ],
    },
    {
      id: "additional_insureds",
      title: "Additional Insureds",
      description:
        "Name, Address and Relationship of all additional insureds to be added to the policy. Leave blank if you don't need an additional insured.",
      fields: [
        {
          type: "content",
          id: "ai_legend",
          variant: "info",
          title: "Relationship legend",
          body: [
            "L - Landlord, V - Venue, E - Event Operator, F - Franchisor/Franchise Owner, G - Governmental Agency, IC - Independent Contractor (Cost: $75)",
            "Additional Insureds requiring Primary Non-Contributory Endorsements: $100.00 each. Additional Insureds requiring Waiver of Subrogation Endorsements: $100.00 each.",
          ],
        },
        ...[1, 2, 3].flatMap(additionalInsuredFields),
        num("independent_contractors", "Independent Contractors", { width: "half", hint: "Number of independent contractors (x $75.00 each)." }),
      ],
    },
    {
      id: "payment",
      title: "Payment",
      fields: [
        {
          type: "radio",
          id: "payment_amount",
          label: "Enclosed is:",
          options: opts("my payment for the total premium", "20% of my total premium"),
          required: true,
        },
        {
          type: "radio",
          id: "payment_method",
          label: "Payment method:",
          options: opts("Credit Card", "ACH", "Check"),
          required: true,
          hint: "A convenience fee of 3% will be added to Credit Card Transactions. Your agent will contact you to collect payment details securely.",
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
          body: [
            "The ownership, operation, maintenance arising out of the use of inflatable recreational devices or inflatable amusement devices of any kind.",
            "Any use, event, or display arising out of fireworks, or any other use of pyrotechnics including any firework sales.",
            "Any use, handling, or storage of any firearms, ammunition, or explosives.",
            "Any operations involving bungee devices, carnival rides, corn cannons, organized equine racing contests, organized equine vaulting or jumping contests, leasing of horses, jumping pillows, knocker ball, bubble soccer, Zorb ball, mechanical bucking devices including multi-ride attachments, aerial activities above 12 feet, rock climbing activities, activities involving permanent or mobile rock wall climbing structures, zip lines, pumpkin launching devices, rope challenge courses, water skiing, surfing, white water rafting or kayaking, tackle football, ATV/UTV, tracked or trackless train rides, trampolines, bike related trick or stunt activities or contests, Zippy Pets, haunted houses, haunted trails or haunted boats or barges, demolition derbies of any kind, independent security services other than a contracted public law enforcement officer.",
          ],
        },
        {
          type: "content",
          id: "acknowledgments",
          variant: "notice",
          title: "Acknowledgments",
          body: [
            "a. This summary of coverage and exclusions is no substitute for reading the entire policy. To receive an entire policy, contact the program administrator.",
            "b. Waiver Requirement: Each school or studio must implement a Release and Waiver of Liability and Indemnity Agreement for all students and staff members. Unintentional error on your part in securing Waiver and Release forms shall not void your coverage in the event of an occurrence to a student or staff member. However, your failure to maintain an adequate system to regularly secure Waiver and Release forms shall void your coverage in the event of an occurrence to a student or staff member. A sample waiver and release form is available upon request.",
            "c. Fraud Warning: Any person who knowingly and with intent to defraud any insurance company or other person files an application for insurance or statement of claim containing any materially false information, or conceals for the purpose of misleading, information concerning any fact material there to, commits a fraudulent insurance act, which may be a crime.",
            "d. Applicant’s Acknowledgment: I, the applicant, declare, to the best of my knowledge and belief, that all statements and answers in this application are true and complete. I understand and agree that (e) this application will form part of any policy issued, (f) no information given to or acquired by any representative of the Company will bind it, unless it is in writing on this application, (g) no waiver or modification will bind the Company unless it is in writing and is signed by an executive officer of the Company, and (h) only those persons eligible under the terms of an issued policy will be insured.",
          ],
        },
        { type: "signature", id: "signature", label: "Signed for the Proposed Policyholder", required: true },
        { type: "date", id: "signature_date", label: "Date", required: true, width: "half" },
        {
          type: "content",
          id: "agency_info",
          variant: "info",
          title: "Licensed Agent",
          body: [
            "Agency Name: Anthony Insurance Services, Inc.",
            "Agency License Number: On File · Agent Phone Number: 303-408-5705 · Agent Email Address: Caitlyn@anthonyinsuranceservices.com",
            "Agency Mailing Address: PO Box 927, Edwards CO 81632",
            "The licensed agent signs the application after review.",
          ],
        },
      ],
    },
  ],
};
