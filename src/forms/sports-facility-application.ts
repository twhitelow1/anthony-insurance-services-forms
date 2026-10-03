import {
  all,
  any,
  includes,
  is,
  isYes,
  money,
  num,
  opts,
  parseMoney,
  text,
  US_STATES,
  yesNo,
} from "@/lib/forms/helpers";
import type { Field, FormDefinition, FormValues } from "@/lib/forms/types";

/**
 * Sports & Recreation Facility — General Liability / Accident & Health application.
 * Transcribed from the original GHL form 2rfgPVPlD4jV4cvjczTY.
 *
 * GHL mapping: unless a field says otherwise, it maps to the GHL custom field
 * whose name matches its label. `ghl.name` overrides that where the GHL field
 * name differs from what we display. Dropdowns marked `syncOptionsFromGhl` pull
 * their options from GHL at runtime; the options listed here are fallbacks.
 */

const locationCount = (v: FormValues) => Number(v.location_count ?? 0);

function locationFields(n: number): Field[] {
  const tag = `Location #${String(n).padStart(2, "0")}`;
  const showIf = (v: FormValues) => locationCount(v) >= n;
  return [
    { type: "content", id: `location_${n}_heading`, title: tag, variant: "subheading", showIf },
    text(`location_${n}_street`, "Street Address", { required: true, showIf, ghl: { name: `Street Address - ${tag}` } }),
    text(`location_${n}_city`, "City", { required: true, showIf, width: "third", ghl: { name: `City - ${tag}` } }),
    {
      type: "select",
      id: `location_${n}_state`,
      label: "State",
      options: US_STATES,
      required: true,
      showIf,
      width: "third",
      ghl: { name: `State - ${tag}` },
    },
    text(`location_${n}_zip`, "ZIP Code", { required: true, showIf, width: "third", ghl: { name: `ZIP Code - ${tag}` } }),
  ];
}

const AGE_COLUMNS = [
  { id: "u12", label: "12 & Under" },
  { id: "a13_15", label: "13-15" },
  { id: "a16_18", label: "16-18" },
  { id: "a19", label: "19+" },
] as const;

const hasAerial = (v: FormValues) => Array.isArray(v.aerial_offerings) && v.aerial_offerings.length > 0;

export const sportsFacilityApplication: FormDefinition = {
  slug: "sports-facility-application",
  title: "Sports & Recreation Facility Application",
  subtitle: "General Liability and Accident & Health coverage",
  tags: ["form:sports-facility-application", "commercial-application"],
  source: "Anthony Insurance Forms — Sports Facility Application",
  successMessage:
    "Thank you! Your application has been submitted. An Anthony Insurance Services agent will review it and reach out shortly.",
  sections: [
    {
      id: "applicant",
      title: "Applicant Information",
      fields: [
        {
          type: "content",
          id: "instructions",
          title: "Instructions",
          variant: "info",
          body: [
            "Complete all sections. If you need more room, email additional pages to your agent.",
            "All questions must be answered. If not applicable, enter N/A.",
            "This application must be signed and dated by an authorized representative.",
            "Completion of this application does not bind coverage.",
          ],
        },
        { type: "date", id: "requested_effective_date", label: "Requested Effective Date", required: true, width: "half" },
        { type: "content", id: "applicant_spacer", variant: "subheading", title: "Contact" },
        text("first_name", "First Name", { required: true, width: "half", ghl: { standard: "firstName" } }),
        text("last_name", "Last Name", { required: true, width: "half", ghl: { standard: "lastName" } }),
        { type: "tel", id: "phone", label: "Phone", required: true, width: "half", ghl: { standard: "phone" } },
        { type: "email", id: "email", label: "Email", required: true, width: "half", ghl: { standard: "email" } },
        { type: "url", id: "website", label: "Business Website", placeholder: "www.example.com", ghl: { standard: "website" } },
        { type: "content", id: "mailing_heading", variant: "subheading", title: "Mailing Address" },
        text("mailing_address", "Mailing Address", { required: true, ghl: { standard: "address1" } }),
        text("mailing_city", "City", { required: true, width: "third", ghl: { standard: "city" } }),
        { type: "select", id: "mailing_state", label: "State", options: US_STATES, required: true, width: "third", ghl: { standard: "state" } },
        text("mailing_postal_code", "Postal Code", { required: true, width: "third", ghl: { standard: "postalCode" } }),
        yesNo("mailing_same_as_physical", "Is your mailing address the same as your physical address?"),
      ],
    },
    {
      id: "locations",
      title: "Location Information",
      fields: [
        {
          type: "select",
          id: "location_count",
          label: "How many locations do you have?",
          options: opts("1", "2", "3", "4", "5"),
          required: true,
          width: "half",
          hint: "More than 5 locations? Email your agent the additional addresses.",
        },
        ...[1, 2, 3, 4, 5].flatMap(locationFields),
        {
          type: "select",
          id: "primary_location",
          label: "Which one is your primary location?",
          options: opts("Location #01", "Location #02", "Location #03", "Location #04", "Location #05"),
          syncOptionsFromGhl: true,
          filterOptions: (options, v) => options.slice(0, Math.max(locationCount(v), 1)),
          required: true,
          width: "half",
          showIf: (v) => locationCount(v) > 0,
        },
      ],
    },
    {
      id: "business",
      title: "Business Information",
      fields: [
        text("legal_business_name", "Legal Business Name", {
          required: true,
          ghl: { standard: "companyName", name: "Legal Business Name" },
        }),
        text("dba", "DBA/Trade Name (If Applicable)"),
        {
          type: "select",
          id: "business_type",
          label: "Type Of Business",
          options: opts("Gymnastics", "Cheer", "Dance", "Martial Arts", "Boxing", "Fitness", "Multi-Sport Facility", "Other"),
          syncOptionsFromGhl: true,
          required: true,
          width: "half",
        },
        num("business_start_year", "Business Start Year", { required: true, min: 1900, max: 2100, width: "half" }),
        {
          type: "textarea",
          id: "business_description",
          label: "Business Description",
          required: true,
          placeholder: "Describe your operations, programs offered, and facility.",
        },
      ],
    },
    {
      id: "general",
      title: "General Questions",
      fields: [
        yesNo("experience_5yrs", "Does insured have at least 5 years of experience in another business in the same industry?"),
        yesNo("waiver_forms", "Does this applicant require waiver/release forms from all participants or parent/legal guardian?"),
        yesNo("prohibited_conduct_defined", "Applicant has prohibited conduct clearly defined in any and all codes of conduct?"),
        yesNo("bankruptcy", "Has applicant ever filed for bankruptcy?"),
        yesNo("non_renewed", "Has applicant ever been non-renewed?"),
        {
          type: "textarea",
          id: "non_renewed_details",
          label: "Please describe the non-renewal",
          required: true,
          showIf: isYes("non_renewed"),
          ghl: { name: "please describe (Has Applicant ever been non-renewed?)" },
        },
        yesNo("claim_over_25k", "Has applicant ever had a claim in the last 5 years over $25,000?"),
      ],
    },
    {
      id: "participants",
      title: "Participant Exposure Information",
      description:
        "List each sport, class, or activity offered at your facility separately. For each activity, provide the estimated total number of annual participants by age group and the number of coaches or instructors involved. Include all applicable activities, such as gymnastics, cheer, dance, fitness, boxing, martial arts, and any other programs offered.",
      fields: [
        {
          type: "table",
          id: "activities",
          label: "Annual Participants by Sport / Activity",
          description: "Estimated annual participants by sport/activity, age group, and number of coaches. Maximum of three entries.",
          maxRows: 3,
          columns: [
            { id: "name", label: "Sport / Activity", type: "text", ghlName: (r) => `Sport / Activity ${r}` },
            ...AGE_COLUMNS.map((c) => ({
              id: c.id,
              label: c.label,
              type: "number" as const,
              ghlName: (r: number) => `Sport / Activity ${r} | ${c.label}`,
            })),
            { id: "coaches", label: "Coaches", type: "number", ghlName: (r) => `Sport / Activity ${r} | Coaches` },
          ],
        },
        {
          type: "table",
          id: "camps",
          label: "Camps / Clinics / Recitals / Special Events",
          description: "Maximum of three entries.",
          maxRows: 3,
          columns: [
            { id: "name", label: "Sport / Activity", type: "text", ghlName: (r) => `Sport / Activity ${r} (Camps)` },
            {
              id: "days",
              label: "# Camp/Clinic Days",
              type: "number",
              ghlName: (r) => `Sport / Activity ${r} (Camps) | # Camp/Clinic Days`,
            },
            ...AGE_COLUMNS.map((c) => ({
              id: c.id,
              label: c.label,
              type: "number" as const,
              ghlName: (r: number) => `Sport / Activity ${r} (Camps) | ${c.label}`,
            })),
          ],
        },
      ],
    },
    {
      id: "gl_limits",
      title: "General Liability Limits",
      fields: [
        {
          type: "select",
          id: "occurrence_limit",
          label: "Each Occurrence Limit",
          options: opts("$1,000,000", "$2,000,000", "$3,000,000", "$4,000,000", "$5,000,000"),
          syncOptionsFromGhl: true,
          required: true,
          width: "half",
        },
        yesNo("occurrence_contract_requirement", "If higher than $1M occurrence, is it a contract requirement?", {
          showIf: (v) => parseMoney(v.occurrence_limit as string) > 1_000_000,
        }),
        text("products_completed_ops_limit", "Products & Completed Operations Limit", {
          width: "half",
          ghl: { name: "Products & Completed Operations Limit - V2" },
        }),
        text("general_aggregate_limit", "General Aggregate Limit", { width: "half", ghl: { name: "General Aggregate Limit - V2" } }),
        text("damage_to_premises_limit", "Damage to Premises Rented Limit", {
          width: "half",
          ghl: { name: "Damage to Premises Rented Limit - V2" },
        }),
        {
          type: "select",
          id: "medical_payment_max",
          label: "Medical Payment Max",
          options: opts("$1,000", "$5,000", "$10,000"),
          syncOptionsFromGhl: true,
          required: true,
          width: "half",
        },
        {
          type: "select",
          id: "sexual_abuse_limit",
          label: "Sexual Abuse Liability Max Limit",
          options: opts("$100,000 / $300,000", "$250,000 / $500,000", "$500,000 / $1,000,000", "$1,000,000 / $1,000,000"),
          syncOptionsFromGhl: true,
          required: true,
          width: "half",
        },

        { type: "content", id: "auto_heading", variant: "subheading", title: "Hired & Non-Owned Auto" },
        yesNo("hnoa", "Add $1M Hired or Non-Owned Auto?"),
        yesNo("commercial_auto_in_force", "Does the insured have a commercial auto policy in force?", { showIf: isYes("hnoa") }),
        yesNo("verify_personal_auto", "Do you verify that personal auto insurance is in place?", { showIf: isYes("hnoa") }),
        yesNo("review_mvrs", "Do you obtain and review motor vehicle reports?", {
          showIf: isYes("hnoa"),
          tooltip: "A motor vehicle report (MVR) is a driver's official driving record from the state, showing violations, accidents, and license status.",
        }),
        yesNo("agree_going_forward", "If either above is 'No', do you agree to do so going forward?", {
          showIf: all(isYes("hnoa"), any(is("verify_personal_auto", "No"), is("review_mvrs", "No"))),
        }),
        num("employees_drive", "Employees that may drive", { width: "third", required: true, showIf: isYes("hnoa") }),
        num("volunteers_drive", "Volunteers that may drive", { width: "third", required: true, showIf: isYes("hnoa") }),
        money("hired_vehicle_cost", "Estimated cost to lease/hire vehicles for coming year", {
          width: "third",
          required: true,
          showIf: isYes("hnoa"),
        }),

        { type: "content", id: "additional_cov_heading", variant: "subheading", title: "Additional Coverages" },
        yesNo("professional_liability", "Professional Liability?"),
        {
          type: "select",
          id: "professional_occurrence_limit",
          label: "Professional Liability Occurrence Limit",
          options: opts("$1,000,000", "$2,000,000"),
          syncOptionsFromGhl: true,
          required: true,
          width: "half",
          showIf: isYes("professional_liability"),
          ghl: { name: "Occurrence Limit" },
        },
        yesNo("employee_benefits", "Add $1M Employee Benefits?", {
          tooltip:
            "Employee Benefits Liability may help protect the business if an error or omission in administering an employee benefit plan causes financial harm—for example, failing to enroll an eligible employee or providing incorrect benefit information. Coverage is subject to the policy’s terms and exclusions.",
        }),
        num("number_of_employees", "Number of Employees", { required: true, width: "half", showIf: isYes("employee_benefits") }),
        yesNo("liquor_liability", "Add $1M/$1M Liquor Liability?", {
          tooltip:
            "Liquor Liability may help protect the business from covered claims of bodily injury or property damage arising from the sale, service, or furnishing of alcohol. Select this option if alcohol is sold, served, or provided at any activity or event.",
        }),
        money("liquor_receipts", "Liquor Receipts", { required: true, width: "half", showIf: isYes("liquor_liability") }),
        yesNo("location_aggregate", "Add Location Aggregate Limit?"),
        yesNo("errors_omissions", "Add $1,000,000/$2,000,000 Errors & Omissions Limit?", {
          tooltip:
            "Errors & Omissions coverage may help protect against covered claims alleging that a mistake, omission, or failure in professional services caused financial loss. The first amount is the per-claim or per-occurrence limit and the second is the aggregate limit.",
        }),
        {
          type: "radio",
          id: "crisis_response",
          label: "Add Crisis Response/Protection Limit",
          options: opts("$25K", "$50K", "$100K", "$250K", "None"),
          required: true,
          tooltip:
            "Crisis Response/Protection may reimburse covered, approved expenses following a qualifying crisis, such as crisis-management, communications, counseling, or security costs. Benefits vary by policy; review the quote and policy terms.",
        },
        yesNo("stop_gap", "Add $1,000,000/$2,000,000 Stop Gap?", {
          tooltip:
            "Stop Gap (Employers Liability) may help cover certain employee-injury claims not covered by a state workers’ compensation fund, including claims alleging employer negligence. It is generally relevant in states with monopolistic state workers’ compensation funds.",
        }),
      ],
    },
    {
      id: "accident_health",
      title: "Accident & Health Limits",
      description: "Required for youth participants.",
      fields: [
        yesNo("dental", "Include Dental Services?", {
          tooltip:
            "If selected, Accident Medical Expense coverage may include eligible dental treatment needed because of a covered accident, subject to the policy’s limit, deductible, and terms.",
        }),
        {
          type: "radio",
          id: "accident_medical_expense",
          label: "Accident Medical Expense",
          options: opts("$25K", "$50K", "$100K"),
          required: true,
          tooltip:
            "Accident Medical Expense helps pay eligible medical costs resulting from a covered accident, up to the selected limit and after the selected deductible. Coverage offered through this application is excess, so other valid health insurance generally pays first.",
        },
        {
          type: "select",
          id: "deductible",
          label: "Your Desired Deductible",
          options: opts("$0", "$100", "$250", "$500", "$1,000"),
          syncOptionsFromGhl: true,
          required: true,
          width: "half",
        },
        {
          type: "content",
          id: "ah_terms",
          variant: "info",
          body: [
            "All Accident Medical coverage offered through this application is on an excess basis.",
            "Coinsurance: 100% · AD&D Benefit: $10,000 · Benefit Period: 52 Weeks · Inpatient ICU/CCU, Ambulatory Surgical, Office Visits: Unlimited",
          ],
        },
      ],
    },
    {
      id: "underwriting",
      title: "Underwriting Questions",
      fields: [
        yesNo("players_compensated", "Are any players compensated/paid to participate?"),
        yesNo("school_sanctioned", "Is the organization sanctioned by a school?"),
        yesNo("residential_property", "Do any activities take place on a residential property?"),
        yesNo("adult_participants_defined", "Does the Risk Management policy define and maintain who 'Adult Participants' are?"),
        yesNo("cardiac_policy", "Is a Cardiac Arrest policy actively used and updated (AED access, CPR certification)?"),
        yesNo("severe_weather_policy", "Is a severe weather policy utilized and regularly updated?"),
        yesNo("heat_index_policy", "Is there a heat index policy with protocols for high temperature/humidity?"),
        yesNo("pool_activities", "Do any activities take place at a pool the applicant owns, operates, leases, or manages?"),
        yesNo("facilities_safety_policy", "Does the organization have a facilities safety policy for potential hazards?"),
        yesNo("concussion_policy", "Is a Concussion & Return-to-Play policy actively enforced and current?"),
        yesNo("disciplinary_policy", "Is a Disciplinary and Appeals policy utilized and periodically reviewed?"),
        yesNo("background_checks_policy", "Is there a background checks policy with defined disqualifying criteria?"),
        yesNo("abuse_training_policy", "Is there an education & training policy including abuse prevention for minors?"),
        yesNo("sexual_abuse_incident", "Has the applicant ever had an incident with allegation of sexual abuse?"),
        yesNo("abuse_prevention_standards", "Does the organization enforce written standards for sexual abuse/molestation prevention?"),
        yesNo("policies_published", "Are risk management policies current, disseminated to staff, and published on website?"),
        yesNo("one_on_one_policy", "Is a one-on-one interactions policy actively implemented and reviewed?"),
        yesNo("online_reporting_form", "Does your organization have an online reporting form for potential abuse/violations?"),
        yesNo("prohibited_behavior_defined", "Does the Risk Management policy define and review prohibited behavior?"),
        yesNo("transports_participants", "Does applicant transport players/participants?"),
        {
          type: "checkboxes",
          id: "transport_method",
          label: "If yes, how?",
          options: opts("Hired Transportation", "Business Owned Vehicle(s)", "Personal Vehicle(s)"),
          required: true,
          showIf: isYes("transports_participants"),
        },
        yesNo("online_training", "Does applicant provide online training/coaching/instruction?"),
        yesNo("retail_sales", "Retail Sales?"),
        money("retail_receipts", "Total Retail Receipts", { required: true, width: "half", showIf: isYes("retail_sales") }),
      ],
    },
    {
      id: "exposures",
      title: "Additional Exposures",
      description: "If an exposure doesn't apply, enter 0 or N/A.",
      fields: [
        text("birthday_parties", "Birthday Parties", { required: true, width: "third", placeholder: "0 or N/A" }),
        text("batting_cages", "Batting Cages", { required: true, width: "third", placeholder: "0 or N/A" }),
        text("booster_clubs", "Booster Clubs", { required: true, width: "third", placeholder: "0 or N/A" }),
        text("inflatables", "Inflatables", { required: true, width: "third", placeholder: "0 or N/A" }),
        text("tanning_units", "Tanning Units", { required: true, width: "third", placeholder: "0 or N/A" }),
        yesNo("soft_play", "Do you offer soft play?", {
          tooltip:
            "Soft play means a specially designed play area where most surfaces and equipment are covered with thick padding, such as padded climbing structures, tunnels, slides, or ball-play areas.",
        }),

        { type: "content", id: "pool_heading", variant: "subheading", title: "Swimming Pools" },
        yesNo("has_pool", "Do You Have Swimming Pool(s)?"),
        {
          type: "radio",
          id: "pool_depth",
          label: "Pool Depth",
          options: opts("4' or less", "5' or more"),
          required: true,
          showIf: isYes("has_pool"),
        },
        yesNo("pool_testing_daily", "Is water testing completed at least daily?", { showIf: isYes("has_pool") }),
        yesNo("pool_testing_logged", "Are water testing results logged and retained?", { showIf: isYes("has_pool") }),
        yesNo("pool_signage", "Pool rules signage posted in the immediate pool area?", { showIf: isYes("has_pool") }),
        yesNo("pool_nonslip", "Does a non-slip surface surround the pool areas?", { showIf: isYes("has_pool") }),
        yesNo("pool_lifeguards", "Are lifeguards required during all hours of swimming pool use?", { showIf: isYes("has_pool") }),
        yesNo("pool_lifesaving_equipment", "Is pool lifesaving equipment kept in an easily accessible location?", { showIf: isYes("has_pool") }),
        yesNo("pool_diving_board", "Is there a diving board?", { showIf: isYes("has_pool") }),
        yesNo("pool_water_slide", "Is there a water slide?", { showIf: isYes("has_pool") }),
        yesNo("pool_parents_present", "Are parents in attendance during swim lessons?", { showIf: isYes("has_pool") }),

        { type: "content", id: "climbing_heading", variant: "subheading", title: "Traverse / Climbing Walls" },
        yesNo("has_climbing_walls", "Do You Have Traverse/Climbing Walls?"),
        num("climbing_wall_count", "Number of Traverse/Climbing Walls", {
          required: true,
          width: "half",
          showIf: isYes("has_climbing_walls"),
          ghl: { name: "Traverse/Climbing Walls" },
        }),
        num("climbing_wall_height", "Height (ft)", { required: true, width: "half", showIf: isYes("has_climbing_walls") }),
        yesNo("climbing_certified_rigger", "Were the climbing walls installed by a certified rigger/engineer?", { showIf: isYes("has_climbing_walls") }),
        yesNo("climbing_inspected", "Are the climbing walls professionally inspected at least annually?", { showIf: isYes("has_climbing_walls") }),
        {
          type: "textarea",
          id: "climbing_instructor_quals",
          label: "Climbing wall instructor qualifications/experience",
          required: true,
          showIf: isYes("has_climbing_walls"),
        },
        yesNo("climbing_padding", "Is padding depth at minimum 12 inches in thickness?", { showIf: isYes("has_climbing_walls") }),
        yesNo("climbing_temp_structures", "Are temporary structures built for climbing outside the facility?", { showIf: isYes("has_climbing_walls") }),
        yesNo("climbing_self_made", "Any self-constructed/self-made climbing walls in the facility?", { showIf: isYes("has_climbing_walls") }),

        { type: "content", id: "aerial_heading", variant: "subheading", title: "Zip Lines / Ropes / Aerial Silks / Trapezes" },
        {
          type: "checkboxes",
          id: "aerial_offerings",
          label: "Check all that your company offers",
          hint: "Leave blank if none apply.",
          options: opts("Zip Lines", "Ropes", "Aerial Silks", "Trapezes"),
          ghl: { name: "Check All That Your Company Offers." },
        },
        num("ziplines_count", "Number of Zip Lines", { required: true, width: "half", showIf: includes("aerial_offerings", "Zip Lines"), ghl: { name: "Zip Lines" } }),
        num("ziplines_height", "Zip Lines Height (ft)", { required: true, width: "half", showIf: includes("aerial_offerings", "Zip Lines"), ghl: { name: "Height (ft): Ziplines" } }),
        num("ropes_count", "Number of Ropes", { required: true, width: "half", showIf: includes("aerial_offerings", "Ropes"), ghl: { name: "Ropes" } }),
        num("ropes_height", "Ropes Height (ft)", { required: true, width: "half", showIf: includes("aerial_offerings", "Ropes"), ghl: { name: "Height (ft): Ropes" } }),
        num("silks_count", "Number of Aerial Silks", { required: true, width: "half", showIf: includes("aerial_offerings", "Aerial Silks"), ghl: { name: "Aerial Silks" } }),
        num("silks_height", "Aerial Silks Height (ft)", { required: true, width: "half", showIf: includes("aerial_offerings", "Aerial Silks"), ghl: { name: "Height (ft): Aerial Silks" } }),
        num("trapezes_count", "Number of Trapezes", { required: true, width: "half", showIf: includes("aerial_offerings", "Trapezes"), ghl: { name: "Trapezes" } }),
        num("trapezes_height", "Trapezes Height (ft)", { required: true, width: "half", showIf: includes("aerial_offerings", "Trapezes"), ghl: { name: "Height (ft): Trapezes" } }),
        yesNo("aerial_certified_rigger", "Were the zipline/ropes/silks/trapezes installed by a certified rigger/engineer?", { showIf: hasAerial }),
        yesNo("aerial_inspected", "Are zipline/ropes/silks/trapezes professionally inspected at least annually?", { showIf: hasAerial }),
        {
          type: "textarea",
          id: "aerial_instructor_quals",
          label: "Zipline/ropes/silks/trapezes instructor qualifications/experience",
          required: true,
          showIf: hasAerial,
        },
        yesNo("aerial_padding", "Is the padding at least 12 inches of depth?", { showIf: hasAerial }),
        yesNo("aerial_temp_structures", "Are temporary structures built for zipline/ropes/silks/trapezes outside the facility?", { showIf: hasAerial }),
        yesNo("aerial_self_made", "Any self-constructed/self-made zipline/ropes/silks/trapezes in the facility?", { showIf: hasAerial }),

        { type: "content", id: "trampoline_heading", variant: "subheading", title: "Trampolines" },
        yesNo("has_trampolines", "Do You Have Trampolines?"),
        num("trampoline_count", "Number of Trampolines", { required: true, width: "half", showIf: isYes("has_trampolines") }),
        yesNo("trampoline_above_ground", "Do you have an above-ground trampoline greater than 4ft (other than tumble track)?", {
          showIf: isYes("has_trampolines"),
        }),
        yesNo("trampoline_padding", "Does the trampoline have 6-inch minimum padding all the way around?", { showIf: isYes("has_trampolines") }),
      ],
    },
    {
      id: "additional_insured",
      title: "Additional Insured",
      description: "Leave blank if you don't need an additional insured.",
      fields: [
        {
          type: "content",
          id: "ai_notice",
          variant: "info",
          body: "If you have more than 2 Additional Insureds, email us at Melanie@anthonyinsuranceservices.com",
        },
        {
          type: "content",
          id: "ai_landlord_heading",
          variant: "subheading",
          title: "Additional Insured (Landlord)",
          body: "Requires Primary Non-Contributory Endorsement",
        },
        text("ai_landlord_name", "Name", { ghl: { name: "Name" } }),
        text("ai_landlord_address", "Address", { ghl: { name: "Address" } }),
        text("ai_landlord_city", "City", { width: "third", ghl: { name: "City" } }),
        { type: "select", id: "ai_landlord_state", label: "State", options: US_STATES, width: "third", ghl: { name: "State" } },
        text("ai_landlord_zip", "Zip Code", { width: "third", ghl: { name: "Zip Code" } }),
        {
          type: "content",
          id: "ai_other_heading",
          variant: "subheading",
          title: "Additional Insured (Other — By Written Contract)",
          body: "Requires Primary Non-Contributory Endorsement",
        },
        text("ai_other_name", "Additional Insured Name"),
        text("ai_other_address", "Additional Insured Address"),
        text("ai_other_city", "Additional Insured City", { width: "third" }),
        { type: "select", id: "ai_other_state", label: "Additional Insured State", options: US_STATES, width: "third" },
        text("ai_other_zip", "Additional Insured Zip Code", { width: "third" }),
      ],
    },
    {
      id: "signature",
      title: "Representations, Warranty & Signature",
      fields: [
        {
          type: "content",
          id: "representations",
          variant: "notice",
          title: "The undersigned declares that the statements in this application are true, complete, and accurate. The undersigned understands that:",
          body: [
            "This application shall be the basis of any policy issued.",
            "The insurer may rely on the completeness and accuracy of information provided.",
            "Any material misrepresentation may void coverage.",
            "Signing this application does not bind coverage.",
            "The applicant agrees to notify the insurer of material changes prior to inception.",
            "NOTICE: Any person who knowingly files a materially false statement may be guilty of insurance fraud and subject to criminal and civil penalties.",
          ],
        },
        { type: "signature", id: "signature", label: "Applicant's Signature", required: true, ghl: { name: "Applicants Signature" } },
      ],
    },
  ],
};
