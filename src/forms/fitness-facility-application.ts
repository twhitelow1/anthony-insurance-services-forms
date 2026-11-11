import { isYes, money, num, opts, text, US_STATES, yesNo } from "@/lib/forms/helpers";
import type { Field, FormDefinition, FormValues } from "@/lib/forms/types";

/**
 * Fitness Class & Cross Training Facilities application (used for yoga studios, pilates studios and health clubs).
 * Transcribed from the carrier PDF "Specialty Insurance Coverage for Fitness Class and Cross Training Facilities"
 * (FORM: CTF REV 2/28/2023):
 * https://dancestudioinsurance.com/wp-content/uploads/2023/05/Fitness-and-Cross-Training-Facilities-DSI_App-Only.pdf
 *
 * The PDF's automated premium calculator fields (rate per participant, minimum premium, totals, broker fee)
 * are calculated by the agency and are not asked here. Since 2026-11-11 the form takes no payment: submitting is a request
 * for a quote, and the agency sends the quote and payment instructions after its review.
 */

const RELATIONSHIPS = opts(
  "L - Landlord",
  "V - Venue",
  "E - Event Operator",
  "F - Franchisor/Franchise Owner",
  "G - Governmental Agency",
  "IC - Independent Contractor (Cost: $75)",
);

const AI_MAX = 10;
const AI_COUNT = "ai_count";

/** Entry n of Additional Insureds: only #1 shows at first; "+ Add Another Additional Insured" shows the next. */
function additionalInsuredFields(n: number): Field[] {
  // Applications from before the "+ Add Another" button have no count: their filled entries still show.
  const shown = (v: FormValues) =>
    n === 1 || (v[AI_COUNT] === undefined ? Object.keys(v).some((k) => k.startsWith(`ai_${n}_`) && !!v[k]) : Number(v[AI_COUNT]) >= n);
  const had = (id: string) => (v: FormValues) => shown(v) && !!v[id];
  return [
    { type: "content", id: `ai_${n}_heading`, title: `Additional Insured #${n}`, variant: "subheading", showIf: shown, removes: { repeat: AI_COUNT, prefix: "ai_", entry: n } },
    text(`ai_${n}_name`, "Full Legal Name", { showIf: shown }),
    // Earlier applications asked for an email and the address in one line: kept so their answers still show.
    { type: "email", id: `ai_${n}_email`, label: "Email Address (earlier applications)", showIf: had(`ai_${n}_email`) },
    text(`ai_${n}_address`, "Full Mailing Address (earlier applications)", { showIf: had(`ai_${n}_address`) }),
    text(`ai_${n}_street`, "Street Address", { showIf: shown }),
    text(`ai_${n}_city`, "City", { width: "third", showIf: shown }),
    { type: "select", id: `ai_${n}_state`, label: "State", options: US_STATES, width: "third", showIf: shown },
    text(`ai_${n}_zip`, "ZIP Code", { width: "third", showIf: shown }),
    { type: "select", id: `ai_${n}_relationship`, label: "Relationship to Your Studio", options: RELATIONSHIPS, width: "half", showIf: shown },
    {
      type: "checkboxes",
      id: `ai_${n}_endorsements`,
      label: "Endorsements: select only if required by your landlord, venue, or contract.",
      options: opts(
        "Additional Insured Endorsement Page / CG2026",
        "Primary and Non-Contributory – Additional $100",
        "Waiver of Subrogation – Additional $100",
      ),
      showIf: shown,
    },
  ];
}

const LOC_MAX = 10;
const LOC_COUNT = "loc_count";
const str = (v: FormValues[string]) => (typeof v === "string" ? v.trim() : "");

/**
 * Studio location n. Location 1 is the mailing address when the applicant says so; otherwise it's asked.
 * "+ Add Another Location" shows the next one (2 to 10), each with Remove.
 */
function locationFields(n: number): Field[] {
  const shown = (v: FormValues) => (n === 1 ? v.studio_same_as_mailing === "No" : Number(v[LOC_COUNT]) >= n);
  return [
    { type: "content", id: `loc_${n}_heading`, title: `Location #${n}`, variant: "subheading", showIf: shown, removes: { repeat: LOC_COUNT, prefix: "loc_", entry: n } },
    text(`loc_${n}_street`, "Street Address", { required: true, width: "half", showIf: shown, hint: n === 1 ? "No P.O. Boxes." : undefined }),
    text(`loc_${n}_unit`, "Suite/Unit", { width: "half", showIf: shown }),
    text(`loc_${n}_city`, "City", { required: true, width: "third", showIf: shown }),
    { type: "select", id: `loc_${n}_state`, label: "State", options: US_STATES, required: true, width: "third", showIf: shown },
    text(`loc_${n}_zip`, "ZIP Code", { required: true, width: "third", showIf: shown }),
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
      description: "Please fill out the application below. Once received, a quote will be emailed to you to review.",
      fields: [
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
          type: "content",
          id: "locations_heading",
          variant: "subheading",
          title: "Studio Physical Location(s)",
          body: "List every physical location where your business provides classes, instruction, or training. Do not use a P.O. Box.",
        },
        yesNo("studio_same_as_mailing", "Is your studio’s physical address the same as your mailing address?"),
        text("loc_1_mailing", "Location #1", {
          showIf: (v) => v.studio_same_as_mailing === "Yes",
          hint: "Your mailing address, as you said above.",
          // Worked out, not typed: the mailing address is Location 1.
          compute: (v) =>
            [str(v.mailing_address), str(v.mailing_city), [str(v.mailing_state), str(v.mailing_postal_code)].filter(Boolean).join(" ")].filter(Boolean).join(", ") ||
            undefined,
        }),
        ...Array.from({ length: LOC_MAX }, (_, i) => locationFields(i + 1)).flat(),
        {
          type: "repeat",
          id: LOC_COUNT,
          addLabel: "+ Add Another Location",
          prefix: "loc_",
          max: LOC_MAX,
          showIf: (v) => v.studio_same_as_mailing === "Yes" || v.studio_same_as_mailing === "No",
        },
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
        // Asked as "renewing" (not "non-renewing") since 2026-11-11; kept so earlier answers still show.
        yesNo("insurer_non_renewing", "Is your current insurer non-renewing coverage? (earlier applications)", {
          required: false,
          showIf: (v) => !!v.insurer_non_renewing,
        }),
        {
          type: "radio",
          id: "insurer_renewing",
          label: "Is your current insurance company renewing your policy this year?",
          options: [
            { label: "Yes: they're renewing it", value: "Yes" },
            { label: "No: they sent you a letter saying they won't renew", value: "No" },
          ],
          stacked: true,
          required: true,
        },
        yesNo("claims_paid_3yrs", "Have any liability claims been paid by your insurer during the last 3 years?"),
        { type: "textarea", id: "claims_description", label: "If yes, describe claims:", required: true, showIf: isYes("claims_paid_3yrs") },
        yesNo("safety_training_program", "Does your organization have a formal safety training program for employees?"),
        yesNo("surveillance_cameras", "Does your organization have surveillance cameras?"),
        yesNo("central_station_alarm", "Does your organization have central station fire and burglar alarm?"),
        yesNo("air_supported_structure", "Does your organization include an air supported structure and/or dome?"),
        yesNo("incident_reports", "Are incident reports completed and maintained for all injuries, regardless of severity?"),
        yesNo("playground_equipment", "Does your organization have playground equipment?"),
        money("annual_gross_receipts", "Please enter your Annual Gross Receipt (USD):", {
          required: true,
          width: "half",
          tooltip: "Total income your studio earns before expenses, including memberships, classes, private sessions, workshops, and retail sales.",
        }),
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
      id: "participants_coverage",
      title: "Participants & Coverage Selections",
      fields: [
        num("number_of_participants", "Number of Participants", {
          required: true,
          width: "half",
          hint: "Please provide total number of participants in the busiest month of the year.",
        }),
        {
          type: "select",
          id: "general_liability_aggregate",
          label: "General Liability Aggregate",
          options: opts("$1,000,000", "$2,000,000", "$3,000,000", "$4,000,000", "$5,000,000"),
          required: true,
          width: "half",
        },
        {
          type: "radio",
          id: "hnoa_coverage",
          label: "Hired and non-owned automobile liability coverage",
          options: opts("$250,000 for an additional $250.00", "$500,000 for an additional $500.00", "No, thank you."),
          required: true,
          tooltip:
            "Liability coverage for certain business use of rented vehicles or vehicles your business does not own, such as employees’ personal cars. Does not cover vehicle damage. Twelve- and fifteen-passenger vans are ineligible for this program.",
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
      ],
    },
    {
      id: "additional_insureds",
      title: "Additional Insureds",
      description: "Optional. Skip this section if you have no additional insured requests.",
      fields: [
        {
          type: "content",
          id: "ai_info",
          variant: "info",
          bodyStyle: "paragraphs",
          body: [
            "Additional Insureds are organizations or property owners added to your liability policy, such as your studio’s landlord, a gym or community center where you teach, a franchisor, or a park or recreation district where you hold outdoor classes. Standard additional insureds are included at no additional cost.",
            "If your landlord, venue, or a contract requires additional insured status, enter the name and address exactly as requested and describe its relationship to your studio. Please provide any special insurance requirements or requested wording.",
            "Primary and Non-Contributory and Waiver of Subrogation endorsements cost an additional $100 each, per additional insured. Select endorsements only if required. They are requests for our review: nothing is charged online, and any fees are included in your quote.",
            "If you have no additional insured requests at this time, you may skip this section and request additions later.",
          ],
        },
        ...Array.from({ length: AI_MAX }, (_, i) => additionalInsuredFields(i + 1)).flat(),
        { type: "repeat", id: AI_COUNT, addLabel: "+ Add Another Additional Insured", prefix: "ai_", max: AI_MAX },
        num("independent_contractors", "Independent Contractors", { width: "half", hint: "Number of independent contractors (x $75.00 each)." }),
      ],
    },
    {
      id: "signature",
      title: "Acknowledgments and Signatures",
      fields: [
        {
          type: "content",
          id: "quote_request",
          variant: "info",
          title: "This is a request for a quote",
          body: "Submitting this application is a request for a quote and does not bind coverage. Coverage begins only once Anthony Insurance Services confirms it. No payment is taken with this application: after we review it, we’ll email you your quote and payment instructions.",
        },
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
          id: "policy_information",
          variant: "notice",
          title: "Policy Information",
          body: "This summary of coverage and exclusions is no substitute for reading the entire policy. To receive an entire policy, contact the program administrator.",
        },
        {
          type: "content",
          id: "waiver_requirement",
          variant: "notice",
          title: "Waiver Requirement",
          body: "Each school or studio must implement a Release and Waiver of Liability and Indemnity Agreement for all students and staff members. Unintentional error on your part in securing Waiver and Release forms shall not void your coverage in the event of an occurrence to a student or staff member. However, your failure to maintain an adequate system to regularly secure Waiver and Release forms shall void your coverage in the event of an occurrence to a student or staff member. A sample waiver and release form is available upon request.",
        },
        {
          type: "content",
          id: "fraud_warning",
          variant: "notice",
          title: "Fraud Warning",
          body: "Any person who knowingly and with intent to defraud any insurance company or other person files an application for insurance or statement of claim containing any materially false information, or conceals for the purpose of misleading, information concerning any fact material there to, commits a fraudulent insurance act, which may be a crime.",
        },
        {
          type: "content",
          id: "applicant_acknowledgment",
          variant: "notice",
          title: "Applicant’s Acknowledgment",
          body: "I, the applicant, declare, to the best of my knowledge and belief, that all statements and answers in this application are true and complete. I understand and agree that (e) this application will form part of any policy issued, (f) no information given to or acquired by any representative of the Company will bind it, unless it is in writing on this application, (g) no waiver or modification will bind the Company unless it is in writing and is signed by an executive officer of the Company, and (h) only those persons eligible under the terms of an issued policy will be insured.",
        },
        { type: "signature", id: "signature", label: "Signed for the Proposed Policyholder", required: true },
        { type: "date", id: "signature_date", label: "Date", required: true, width: "half" },
        // The Payment step was removed on 2026-11-11 (quotes and payment instructions come separately); earlier answers still show.
        { type: "radio", id: "payment_amount", label: "Enclosed is: (earlier applications)", options: opts("my payment for the total premium", "20% of my total premium"), showIf: (v) => !!v.payment_amount },
        { type: "radio", id: "payment_method", label: "Payment method: (earlier applications)", options: opts("Credit Card", "ACH", "Check"), showIf: (v) => !!v.payment_method },
      ],
    },
  ],
};
