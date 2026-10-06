import { all, any, includes, is, isYes, money, num, opts, parseMoney, text, US_STATES, yesNo } from "@/lib/forms/helpers";
import type { Field, FormDefinition, FormValues } from "@/lib/forms/types";

/**
 * Gymnastics — Sports Team/League/Association/Facility application.
 * Based on the carrier PDF (DSI-Application.pdf, "Sports Team/League/Association/Facility Application"):
 * https://dancestudioinsurance.com/wp-content/uploads/2024/01/DSI-Application.pdf
 * Every question from the website form (https://dancestudioinsurance.com/gymnastics-insurance-application/,
 * GHL widget XMURWOwptJyzSHt4WA3d) is also covered; website-only questions are placed next to the closest
 * PDF question.
 */

const additionalLocationCount = (v: FormValues) => Number(v.additional_location_count ?? 0);

function additionalLocationFields(n: number): Field[] {
  const showIf = (v: FormValues) => additionalLocationCount(v) >= n;
  return [
    { type: "content", id: `additional_location_${n}_heading`, title: `Additional Location #${n}`, variant: "subheading", showIf },
    text(`additional_location_${n}_street`, "Street Address", { required: true, showIf }),
    text(`additional_location_${n}_city`, "City", { required: true, showIf, width: "third" }),
    { type: "select", id: `additional_location_${n}_state`, label: "State", options: US_STATES, required: true, showIf, width: "third" },
    text(`additional_location_${n}_zip`, "Zip Code", { required: true, showIf, width: "third" }),
  ];
}

function additionalInsuredFields(n: number): Field[] {
  return [
    { type: "content", id: `ai_${n}_heading`, variant: "subheading", title: `Additional Insured #${n} (by written contract)` },
    {
      type: "checkboxes",
      id: `ai_${n}_primary_noncontributory`,
      label: "Endorsement",
      options: opts("Requires Primary Non-Contributory endorsement"),
    },
    text(`ai_${n}_name`, "Name"),
    text(`ai_${n}_address`, "Address"),
    text(`ai_${n}_city`, "City", { width: "third" }),
    { type: "select", id: `ai_${n}_state`, label: "State", options: US_STATES, width: "third" },
    text(`ai_${n}_zip`, "Zip Code", { width: "third" }),
  ];
}

const AGE_COLUMNS = [
  { id: "u12", label: "12 & Under" },
  { id: "a13_15", label: "13-15" },
  { id: "a16_18", label: "16-18" },
  { id: "a19", label: "19+" },
] as const;

const exposuresApply = (v: FormValues) => !(Array.isArray(v.exposures_na) && v.exposures_na.includes("N/A"));
const countAbove0 = (...ids: string[]) => (v: FormValues) => ids.some((id) => Number(v[id] ?? 0) > 0);
const hasPools = all(exposuresApply, countAbove0("pool_count"));
const hasClimbingWalls = all(exposuresApply, countAbove0("climbing_walls_up_to_10", "climbing_walls_10_to_20", "climbing_walls_over_20"));
const hasAerial = all(
  exposuresApply,
  countAbove0(
    "ziplines_under_6",
    "ziplines_over_6",
    "trapezes_under_6",
    "trapezes_over_6",
    "ropes_under_6",
    "ropes_over_6",
    "silks_under_6",
    "silks_over_6",
  ),
);
const facility = isYes("owns_facility");

export const gymnasticsApplication: FormDefinition = {
  slug: "gymnastics-application",
  title: "Gymnastics Facility Application",
  subtitle: "General Liability and Accident & Health coverage for gymnastics teams, leagues and facilities",
  tags: ["form:gymnastics-application", "sports"],
  source: "Anthony Insurance Forms — Gymnastics Facility Application",
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
            "Complete all sections. Attach additional pages if needed.",
            "All questions must be answered. If not applicable, indicate N/A.",
            "This application must be signed and dated by an authorized representative.",
            "Completion of this application does not bind coverage.",
          ],
        },
        { type: "date", id: "requested_effective_date", label: "Requested Effective Date of Coverage", required: true, width: "half" },
        text("legal_business_name", "Name of the Applicant", { required: true, ghl: { standard: "companyName" } }),
        text("dba", "DBA/Trade Name (If Applicable)"),
        { type: "content", id: "contact_heading", variant: "subheading", title: "Contact" },
        text("first_name", "Contact First Name", { required: true, width: "half", ghl: { standard: "firstName" } }),
        text("last_name", "Contact Last Name", { required: true, width: "half", ghl: { standard: "lastName" } }),
        text("contact_title", "Title", { width: "half" }),
        { type: "tel", id: "phone", label: "Phone", required: true, width: "half", ghl: { standard: "phone" } },
        { type: "email", id: "email", label: "Email", required: true, ghl: { standard: "email" } },
        { type: "url", id: "website", label: "Business Website", placeholder: "www.example.com", ghl: { standard: "website" } },
        { type: "content", id: "business_heading", variant: "subheading", title: "Business" },
        num("business_start_year", "Business Start Year", { required: true, min: 1900, max: 2100, width: "half" }),
        {
          type: "radio",
          id: "business_entity",
          label: "Form of Business",
          options: opts("LLC", "Individual", "Partnership", "Joint Venture", "Trust", "Other"),
          required: true,
        },
        {
          type: "radio",
          id: "type_of_risk",
          label: "Type of Risk",
          options: opts("Association", "Facility", "League", "Team", "Other"),
          required: true,
        },
        text("type_of_risk_other", "Other (explain)", { required: true, showIf: is("type_of_risk", "Other") }),
        {
          type: "select",
          id: "business_type",
          label: "Type Of Business",
          options: opts("Gymnastics", "Cheer", "Dance", "Martial Arts", "Boxing", "Fitness", "Multi-Sport Facility", "Other"),
          required: true,
          width: "half",
        },
        {
          type: "textarea",
          id: "business_description",
          label: "Description of operations",
          required: true,
          placeholder: "Describe your operations, programs offered, and facility.",
        },
        { type: "content", id: "physical_heading", variant: "subheading", title: "Physical Address" },
        text("physical_address", "Physical Address", { required: true }),
        text("physical_city", "City", { required: true, width: "third" }),
        { type: "select", id: "physical_state", label: "State", options: US_STATES, required: true, width: "third" },
        text("physical_zip", "Zip Code", { required: true, width: "third" }),
        yesNo("mailing_same_as_physical", "Is your Mailing address same as your Physical Address?"),
        { type: "content", id: "mailing_heading", variant: "subheading", title: "Mailing Address" },
        text("mailing_address", "Mailing Address", { required: true, ghl: { standard: "address1" } }),
        text("mailing_city", "City", { required: true, width: "third", ghl: { standard: "city" } }),
        { type: "select", id: "mailing_state", label: "State", options: US_STATES, required: true, width: "third", ghl: { standard: "state" } },
        text("mailing_postal_code", "Zip Code", { required: true, width: "third", ghl: { standard: "postalCode" } }),
        { type: "content", id: "additional_locations_heading", variant: "subheading", title: "Additional Location(s)" },
        {
          type: "select",
          id: "additional_location_count",
          label: "How many additional locations do you have?",
          options: opts("0", "1", "2", "3", "4"),
          required: true,
          width: "half",
          hint: "More locations? Email your agent the additional addresses.",
        },
        ...[1, 2, 3, 4].flatMap(additionalLocationFields),
      ],
    },
    {
      id: "general",
      title: "General Questions",
      fields: [
        {
          type: "radio",
          id: "applicant_category",
          label: "Is applicant a Sport, Facility or a Camp/Event?",
          options: opts("Sport", "Facility", "Camp/Event"),
          required: true,
        },
        yesNo("experience_5yrs", "Does insured have at least 5 years of experience in another business in the same industry?"),
        yesNo(
          "waiver_forms",
          "Does the applicant/organization require Waivers/Release forms from all participants or parent/legal guardian?",
        ),
        yesNo("code_of_conduct", "Does the Applicant/Organization have a Code of Conduct?"),
        yesNo("prohibited_conduct_defined", "Applicant has prohibited conduct clearly defined in any and all codes of conduct?"),
        yesNo("bankruptcy", "Has applicant ever filed for bankruptcy?"),
        yesNo("prior_insurance", "Is there prior insurance coverage?"),
        text("current_carrier", "If yes, who is your current insurance provider/carrier?", { required: true, showIf: isYes("prior_insurance") }),
        yesNo("non_renewed", "Has applicant ever been non-renewed?"),
        { type: "textarea", id: "non_renewed_details", label: "Please describe the non-renewal", required: true, showIf: isYes("non_renewed") },
        yesNo("claim_over_25k", "Has applicant had a liability or accident claim in the last 5 years over $25,000?"),
        { type: "textarea", id: "claim_details", label: "Claim(s) details", required: true, showIf: isYes("claim_over_25k") },
        money("annual_revenue", "Annual Revenue", { required: true, width: "half" }),
      ],
    },
    {
      id: "participants",
      title: "Participant Exposure Information (Required)",
      description:
        "Please provide the estimated annual number of participants for each sport/activity and age group for which you would like to provide coverage. Coverage will only be quoted and provided for the sport/activity and age groups you specifically indicate below.",
      fields: [
        {
          type: "table",
          id: "activities",
          label: "Number of participants by Sport / Activity",
          description: "Estimated annual participants by sport/activity, age group, and number of coaches.",
          maxRows: 6,
          columns: [
            { id: "name", label: "Sport / Activity", type: "text" },
            ...AGE_COLUMNS.map((c) => ({ id: c.id, label: c.label, type: "number" as const })),
            { id: "coaches", label: "Coaches", type: "number" },
          ],
        },
        { type: "content", id: "camps_heading", variant: "subheading", title: "Camps / Clinics / Recitals / Special Events" },
        {
          type: "checkboxes",
          id: "camps_na",
          label: "Camps/Clinics/Special Events",
          options: opts("N/A"),
          hint: "Check N/A if you don't hold camps, clinics or special events.",
        },
        {
          type: "table",
          id: "camps",
          label: "Camps / Clinics / Recitals / Special Events — number of participants",
          maxRows: 6,
          showIf: (v) => !includes("camps_na", "N/A")(v),
          columns: [
            { id: "name", label: "Sport / Activity", type: "text" },
            { id: "days", label: "Number of Camp/Clinic Days", type: "number" },
            ...AGE_COLUMNS.map((c) => ({ id: c.id, label: c.label, type: "number" as const })),
          ],
        },
        yesNo("overnight_camps", "Are any camps/clinics overnight?"),
        num("overnight_nights", "If yes, how many nights?", { required: true, width: "half", showIf: isYes("overnight_camps") }),
        yesNo("special_events", "Do you offer special events?"),
        num("special_events_count", "If yes, how many?", { required: true, width: "half", showIf: isYes("special_events") }),
        {
          type: "textarea",
          id: "special_events_details",
          label: "Details of special event(s)",
          required: true,
          showIf: isYes("special_events"),
        },
      ],
    },
    {
      id: "gl_limits",
      title: "General Liability Coverages",
      fields: [
        {
          type: "select",
          id: "occurrence_limit",
          label: "Each Occurrence Limit",
          options: opts("$1,000,000", "$2,000,000", "$3,000,000", "$4,000,000", "$5,000,000", "$6,000,000"),
          required: true,
          width: "half",
        },
        yesNo("occurrence_contract_requirement", "If higher than $1M occurrence, is it a contract requirement?", {
          showIf: (v) => parseMoney(v.occurrence_limit as string) > 1_000_000,
        }),
        {
          type: "select",
          id: "products_completed_ops_limit",
          label: "Products and Completed Operations Limit",
          options: opts("$1,000,000", "$2,000,000", "$3,000,000"),
          required: true,
          width: "half",
        },
        {
          type: "select",
          id: "general_aggregate_limit",
          label: "General Aggregate Limit",
          options: opts("$3,000,000", "$4,000,000", "$5,000,000"),
          required: true,
          width: "half",
        },
        {
          type: "select",
          id: "damage_to_premises_limit",
          label: "Damage to Premises Rented Limit",
          options: opts("$300,000", "$500,000", "$1,000,000"),
          required: true,
          width: "half",
        },
        { type: "content", id: "personal_advertising_injury", variant: "info", body: "Personal Advertising Injury Limit - $1,000,000" },
        {
          type: "radio",
          id: "medical_payments_limit",
          label: "Add Medical Payments Limit?",
          options: opts("$5,000", "$10,000", "$15,000", "$25,000", "No"),
          required: true,
        },
        {
          type: "radio",
          id: "sexual_abuse_limit",
          label: "Add Sexual Abuse Liability Limit?",
          options: opts(
            "$25,000/$100,000",
            "$50,000/$100,000",
            "$100,000/$300,000",
            "$500,000/$500,000",
            "$1,000,000/$1,000,000",
            "$1,000,000/$2,000,000",
            "No",
          ),
          required: true,
        },

        { type: "content", id: "auto_heading", variant: "subheading", title: "Hired & Non-Owned Auto" },
        yesNo("hnoa", "Add $1,000,000 Hired or Non-Owned Auto?"),
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
        {
          type: "radio",
          id: "professional_liability_limit",
          label: "Add Professional Liability Limit?",
          options: opts(
            "$1,000,000/$1,000,000",
            "$1,000,000/$3,000,000",
            "$2,000,000/$3,000,000",
            "$3,000,000/$3,000,000",
            "No",
          ),
          required: true,
        },
        yesNo("employee_benefits", "Add $1,000,000 Employee Benefits?", {
          tooltip:
            "Employee Benefits Liability may help protect the business if an error or omission in administering an employee benefit plan causes financial harm—for example, failing to enroll an eligible employee or providing incorrect benefit information. Coverage is subject to the policy’s terms and exclusions.",
        }),
        num("number_of_employees", "Number of Employees", { required: true, width: "half", showIf: isYes("employee_benefits") }),
        yesNo("liquor_liability", "Add $1,000,000/$1,000,000 Liquor Liability?", {
          tooltip:
            "Liquor Liability may help protect the business from covered claims of bodily injury or property damage arising from the sale, service, or furnishing of alcohol. Select this option if alcohol is sold, served, or provided at any activity or event.",
        }),
        money("liquor_receipts", "Receipts", { required: true, width: "half", showIf: isYes("liquor_liability") }),
        yesNo("location_aggregate", "Add Location Aggregate Limit?"),
        yesNo("errors_omissions", "Add $1,000,000/$2,000,000 Errors & Omissions Limit?", {
          tooltip:
            "Errors & Omissions coverage may help protect against covered claims alleging that a mistake, omission, or failure in professional services caused financial loss. The first amount is the per-claim or per-occurrence limit and the second is the aggregate limit.",
        }),
        {
          type: "radio",
          id: "crisis_response",
          label: "Add Crisis Response or Protection Limit?",
          options: opts("$25,000", "$50,000", "$100,000", "$250,000", "None"),
          required: true,
          tooltip:
            "Crisis Response/Protection may reimburse covered, approved expenses following a qualifying crisis, such as crisis-management, communications, counseling, or security costs. Benefits vary by policy; review the quote and policy terms.",
        },
        yesNo("stop_gap", "Add $1,000,000/$2,000,000 Stop Gap?", {
          hint: "Not available on all classes.",
          tooltip:
            "Stop Gap (Employers Liability) may help cover certain employee-injury claims not covered by a state workers’ compensation fund, including claims alleging employer negligence. It is generally relevant in states with monopolistic state workers’ compensation funds.",
        }),
      ],
    },
    {
      id: "underwriting",
      title: "General Underwriting Questions",
      fields: [
        yesNo("safety_gear_required", "If applicable, will the standard safety gear for the sport be required?"),
        yesNo("players_compensated", "Are any of the applicant's players compensated/paid to participate?"),
        yesNo("school_sanctioned", "Is the applicant's organization sanctioned by a school?"),
        yesNo("residential_property", "Do any activities take place on a residential property?"),
        yesNo("adult_participants_defined", "Does the organization clearly define who Adult Participants are?"),
        yesNo("cardiac_heat_policies", "Applicant has policies in place for cardiac arrest and heat stroke?"),
        yesNo("pool_activities", "Do any activities take place at a pool that the applicant owns, operates, leases or manages?"),
        yesNo("owns_facility", "Does applicant own, operate or manage a facility?"),
        yesNo("facility_unstaffed_24hr", "If yes, do you offer unstaffed access or open 24 hours?", { showIf: facility }),
        yesNo("facility_camera_recordings", "Maintain camera recordings of premises, both inside and outside?", { showIf: facility }),
        yesNo("facility_child_watch", "Offer child watch or day care services?", { showIf: facility }),
        yesNo("facility_member_orientation", "Offer orientation for members?", { showIf: facility }),
        yesNo("facility_rm_policies_distributed", "Risk management policies distributed to staff & readily accessible for members?", {
          showIf: facility,
        }),
        yesNo("facility_staff_certifications", "Education/training in place for staff members to maintain appropriate certifications?", {
          showIf: facility,
        }),
        yesNo("facility_daily_cleaning", "Daily cleaning of the facility & equipment to reduce the spread of communicable disease?", {
          showIf: facility,
        }),
        yesNo("facility_equipment_maintenance", "Equipment maintenance policy in place that includes scheduled inspections with maintenance logs?", {
          showIf: facility,
        }),
        yesNo("facility_equipment_installed_by_vendor", "Is equipment installed by either a manufacturer or a third-party vendor?", {
          showIf: facility,
        }),
        yesNo("facility_signage_policy", "Is there a signage policy for locker rooms, saunas & other high-risk areas?", { showIf: facility }),
        yesNo("facility_video_coverage", "Do you have video coverage of both interior and exterior of the premises?", { showIf: facility }),
        yesNo("facility_recordings_90_days", "If yes, are recordings saved for at least 90 days?", {
          showIf: all(facility, isYes("facility_video_coverage")),
        }),
        yesNo("inspection_guidance", "Do you inspect or provide guidance around inspection of the following?", {
          hint: "Bleachers · Goal safety · Field Maintenance including clean-up of equipment and debris",
        }),
        yesNo(
          "abuse_prevention_standards",
          "Applicant has and enforces written standards regarding Sexual Abuse and Molestation prevention and reporting?",
        ),
        yesNo(
          "background_checks_policy",
          "Applicant has a formal policy for and runs background checks, which includes an appeals policy for disqualified participants?",
        ),
        yesNo("sexual_abuse_incident", "Has the applicant ever had an incident which resulted in allegation of sexual abuse?"),
        yesNo("abuse_training_program", "Is there a formal training program in place for abuse and anti-bullying?"),
        yesNo(
          "one_on_one_policy",
          "Does the applicant have policies and procedures that limit one-on-one interactions (both in person and social media/text/email communications) between adult participants (coaches/trainers) and athletes/participants (particularly those that are minors)?",
        ),
        yesNo("one_on_one_implemented", "If yes, is it implemented?", { showIf: isYes("one_on_one_policy") }),
        yesNo("transports_participants", "Do you transport participants to or from games, camps, clinics or events?"),
        {
          type: "checkboxes",
          id: "transport_method",
          label: "If yes, how?",
          options: opts("Hired Transportation", "Business Owned Vehicle(s)", "Personal Vehicle(s)"),
          required: true,
          showIf: isYes("transports_participants"),
        },
        { type: "textarea", id: "transport_explain", label: "Please explain", required: true, showIf: isYes("transports_participants") },
        yesNo("online_training", "Does Applicant provide online training/coaching/instruction?"),
        yesNo(
          "concussion_awareness_policy",
          "Applicant distributes a written concussion awareness policy (i.e., CDC's HEADS UP) to coaches, parents, and players?",
        ),
        yesNo("concussion_removal", "If a possible concussion has occurred, Applicant immediately removes the athlete from play or practice?"),
        yesNo(
          "concussion_doctor_release",
          "Applicant’s concussion policy requires a medical doctor's release prior to the child returning to play after a suspected concussion?",
        ),
        yesNo("non_profit", "Is applicant a Non-Profit?"),
        yesNo("professional_athletes", "Do you work with professional athletes?"),
        num("professional_athletes_count", "If yes, how many?", { required: true, width: "half", showIf: isYes("professional_athletes") }),
        yesNo("cryotherapy", "Do you offer cryotherapy?"),
        yesNo("soft_play", "Do you offer soft play?", {
          tooltip:
            "Soft play means a specially designed play area where most surfaces and equipment are covered with thick padding, such as padded climbing structures, tunnels, slides, or ball-play areas.",
        }),

        { type: "content", id: "risk_mgmt_heading", variant: "subheading", title: "Risk Management Policies" },
        yesNo("cardiac_aed_policy", "Is a Cardiac Arrest policy actively used and updated (AED access, CPR certification)?"),
        yesNo("severe_weather_policy", "Is a severe weather policy utilized and regularly updated?"),
        yesNo("heat_index_policy", "Is there a heat index policy with protocols for high temperature/humidity?"),
        yesNo("facilities_safety_policy", "Does the organization have a facilities safety policy for potential hazards?"),
        yesNo("concussion_return_to_play", "Is a Concussion & Return-to-Play policy actively enforced and current?"),
        yesNo("disciplinary_policy", "Is a Disciplinary and Appeals policy utilized and periodically reviewed?"),
        yesNo("background_disqualifying_criteria", "Is there a background checks policy with defined disqualifying criteria?"),
        yesNo("abuse_training_minors", "Is there an education & training policy including abuse prevention for minors?"),
        yesNo("policies_published", "Are risk management policies current, disseminated to staff, and published on website?"),
        yesNo("online_reporting_form", "Does your organization have an online reporting form for potential abuse/violations?"),
        yesNo("prohibited_behavior_defined", "Does the Risk Management policy define and review prohibited behavior?"),
      ],
    },
    {
      id: "accident_health",
      title: "Accident and Health Coverages",
      description: "Required with youth participants.",
      fields: [
        {
          type: "radio",
          id: "deductible",
          label: "Deductible",
          options: opts("$100", "$250", "$500", "$1,000"),
          required: true,
        },
        {
          type: "radio",
          id: "accident_medical_expense",
          label: "Accident Medical Expense",
          options: opts("$25,000", "$50,000", "$100,000"),
          required: true,
          tooltip:
            "Accident Medical Expense helps pay eligible medical costs resulting from a covered accident, up to the selected limit and after the selected deductible.",
        },
        {
          type: "radio",
          id: "coverage_type",
          label: "Coverage Type",
          options: opts("Excess", "Primary"),
          required: true,
        },
        {
          type: "content",
          id: "ah_terms",
          variant: "info",
          body: [
            "Coinsurance: 100%",
            "Inpatient ICU, CCU Limit: UNLIMITED · Inpatient Private Semi Private Room Limit: UNLIMITED · Ambulatory Medical or Surgical Center Limit: UNLIMITED · Office Visits Limit: UNLIMITED",
          ],
        },
        {
          type: "radio",
          id: "add_primary_limit",
          label: "Accidental Death and Dismemberment Primary Limit",
          options: opts("$10,000", "Other"),
          required: true,
        },
        money("add_primary_limit_other", "Other AD&D limit", { required: true, width: "half", showIf: is("add_primary_limit", "Other") }),
        yesNo("dental", "Include Dental Services?", {
          tooltip:
            "If selected, Accident Medical Expense coverage may include eligible dental treatment needed because of a covered accident, subject to the policy’s limit, deductible, and terms.",
        }),
      ],
    },
    {
      id: "exposures",
      title: "Additional Exposures (if applicable)",
      fields: [
        {
          type: "checkboxes",
          id: "exposures_na",
          label: "Additional Exposures",
          options: opts("N/A"),
          hint: "Check N/A if none of the exposures below apply. Otherwise enter 0 for any that don't apply.",
        },
        money("retail_receipts", "Retail Store Total Receipts", { required: true, width: "half", showIf: exposuresApply }),
        num("birthday_parties", "Number of Birthday Parties", { required: true, width: "half", showIf: exposuresApply }),
        num("pool_count", "Number of Swimming Pools", { required: true, width: "third", showIf: exposuresApply }),
        yesNo("lifeguards_present", "Are lifeguards present?", { showIf: hasPools }),
        num("diving_boards", "Number of diving boards", { required: true, width: "third", showIf: hasPools }),
        num("slides", "Number of slides", { required: true, width: "third", showIf: hasPools }),
        yesNo("slide_enclosed", "Is slide enclosed?", { showIf: all(hasPools, countAbove0("slides")) }),
        {
          type: "radio",
          id: "pool_depth",
          label: "Pool Depth",
          options: opts("4' or less", "5' or more"),
          required: true,
          showIf: hasPools,
        },
        yesNo("pool_testing_daily", "Is water testing completed at least daily?", { showIf: hasPools }),
        yesNo("pool_testing_logged", "Are water testing results logged and retained?", { showIf: hasPools }),
        yesNo("pool_signage", "Pool rules signage posted in the immediate pool area?", { showIf: hasPools }),
        yesNo("pool_nonslip", "Does a non-slip surface surround the pool areas?", { showIf: hasPools }),
        yesNo("pool_lifeguards", "Are lifeguards required during all hours of swimming pool use?", { showIf: hasPools }),
        yesNo("pool_lifesaving_equipment", "Is pool lifesaving equipment kept in an easily accessible location?", { showIf: hasPools }),
        yesNo("pool_parents_present", "Are parents in attendance during swim lessons?", { showIf: hasPools }),
        num("saunas", "Number of saunas", { required: true, width: "third", showIf: exposuresApply }),
        num("jacuzzis", "Number of Jacuzzis", { required: true, width: "third", showIf: exposuresApply }),
        num("batting_cages", "Number of Batting Cages", { required: true, width: "third", showIf: exposuresApply }),
        num("inflatables", "Number of Inflatables", { required: true, width: "third", showIf: exposuresApply }),

        { type: "content", id: "aerial_heading", variant: "subheading", title: "Zip Lines / Trapezes / Climbing Walls / Ropes / Aerial Silks", showIf: exposuresApply },
        num("ziplines_under_6", "Number of zip lines under 6 ft.", { required: true, width: "half", showIf: exposuresApply }),
        num("ziplines_over_6", "Number of zip lines over 6 ft.", { required: true, width: "half", showIf: exposuresApply }),
        num("trapezes_under_6", "Number of trapezes under 6 ft.", { required: true, width: "half", showIf: exposuresApply }),
        num("trapezes_over_6", "Number of trapezes over 6 ft.", { required: true, width: "half", showIf: exposuresApply }),
        num("climbing_walls_up_to_10", "Number of traverse/climbing wall — Up to 10 ft.", { required: true, width: "third", showIf: exposuresApply }),
        num("climbing_walls_10_to_20", "Number of traverse/climbing wall — 10 and 20 ft.", { required: true, width: "third", showIf: exposuresApply }),
        num("climbing_walls_over_20", "Number of traverse/climbing wall — Over 20 ft.", { required: true, width: "third", showIf: exposuresApply }),
        yesNo("climbing_certified_rigger", "Were the climbing walls installed by a certified rigger/engineer?", { showIf: hasClimbingWalls }),
        yesNo("climbing_inspected", "Are the climbing walls professionally inspected at least annually?", { showIf: hasClimbingWalls }),
        {
          type: "textarea",
          id: "climbing_instructor_quals",
          label: "Climbing wall instructor qualifications/experience",
          required: true,
          showIf: hasClimbingWalls,
        },
        yesNo("climbing_padding", "Is padding depth at minimum 12 inches in thickness?", { showIf: hasClimbingWalls }),
        yesNo("climbing_temp_structures", "Are temporary structures built for climbing outside the facility?", { showIf: hasClimbingWalls }),
        yesNo("climbing_self_made", "Any self-constructed/self-made climbing walls in the facility?", { showIf: hasClimbingWalls }),
        num("ropes_under_6", "Number of climbing ropes under 6 ft.", { required: true, width: "half", showIf: exposuresApply }),
        num("ropes_over_6", "Number of climbing ropes over 6 ft.", { required: true, width: "half", showIf: exposuresApply }),
        num("silks_under_6", "Number of aerial silks under 6 ft.", { required: true, width: "half", showIf: exposuresApply }),
        num("silks_over_6", "Number of aerial silks over 6 ft.", { required: true, width: "half", showIf: exposuresApply }),
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

        { type: "content", id: "other_exposures_heading", variant: "subheading", title: "Tanning, Booster Clubs & Trampolines", showIf: exposuresApply },
        num("tanning_units", "Number of Tanning Units", { required: true, width: "half", hint: "Limit: $100,000/$100,000", showIf: exposuresApply }),
        num("booster_clubs", "Number of Booster Clubs", { required: true, width: "half", showIf: exposuresApply }),
        yesNo("has_trampolines", "Do You Have Trampolines?", { showIf: exposuresApply }),
        num("trampoline_count", "Number of Trampolines", { required: true, width: "half", showIf: all(exposuresApply, isYes("has_trampolines")) }),
        yesNo("trampoline_above_ground", "Do you have an above-ground trampoline greater than 4ft (other than tumble track)?", {
          showIf: all(exposuresApply, isYes("has_trampolines")),
        }),
        yesNo("trampoline_padding", "Does the trampoline have 6-inch minimum padding all the way around?", {
          showIf: all(exposuresApply, isYes("has_trampolines")),
        }),
      ],
    },
    {
      id: "additional_insured",
      title: "Additional Insured (by written contract)",
      description: "Leave blank if you don't need an additional insured.",
      fields: [
        {
          type: "content",
          id: "ai_notice",
          variant: "info",
          body: "If you have more than 2 Additional Insureds, email us at Melanie@anthonyinsuranceservices.com",
        },
        ...[1, 2].flatMap(additionalInsuredFields),
      ],
    },
    {
      id: "signature",
      title: "Representations, Warranty & Signature",
      fields: [
        {
          type: "checkboxes",
          id: "additional_coverage_applications",
          label: "Application needed for additional coverages?",
          options: opts("Property", "Excess Liability"),
        },
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
        { type: "signature", id: "signature", label: "Insured Signature", required: true },
        { type: "date", id: "signature_date", label: "Date", required: true, width: "half" },
      ],
    },
  ],
};
