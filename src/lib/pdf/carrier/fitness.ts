import { formatCurrency } from "@/lib/forms/helpers";
import type { CarrierFormSpec, Filler } from "./types";

/**
 * Specialty Insurance Coverage for Fitness Class and Cross Training Facilities,
 * FORM: CTF REV 2/28/2023 (the Dance Studio Insurance "Fitness and Cross Training
 * Facilities" PDF). Field names are the PDF's own AcroForm names.
 *
 * Yes/No questions are radio groups whose buttons have export values like
 * "Choice1"; the YES button is always the left one. Six group names on page 2
 * are one row off from the question they sit beside (the button named
 * "Incident reports?" is on the playground-equipment row), so the mapping below
 * follows where each button sits on the page, which is what the carrier reads.
 *
 * The premium calculator, payment and card boxes are left empty: the PDF works the
 * premium out itself in Acrobat, and the agency collects payment details.
 *
 * When the carrier sends a new version: replace the template file and update the
 * names below. The test fails on any name or button the template doesn't have, and
 * checks the Yes/No rows are in page order.
 */

/** Web question → [radio group, YES export value, NO export value], in page order. */
export const FITNESS_YES_NO: [id: string, group: string, yes: string, no: string][] = [
  ["weights_over_50lb", "WeightsOver50lb?", "true", "false"],
  // Page 2: General Liability Questionnaire
  ["coverage_canceled_3yrs", "Coverage canceled?", "Choice3", "Choice4"],
  ["waiver_system", "Waiver system?", "Choice1", "Choice2"],
  ["risk_management_plan", "Risk Management Plan?", "Choice1", "Choice2"],
  ["insurer_non_renewing", "Non-renewing coverage?", "Choice3", "Choice4"],
  ["claims_paid_3yrs", "Claims during 3 years?", "Choice1", "Choice2"],
  // The next six group names are one row off (see above).
  ["safety_training_program", "Criminal background checks?", "Choice1", "Choice2"],
  ["surveillance_cameras", "Safety training program?", "Choice2", "Choice3"],
  ["central_station_alarm", "Surveillance cameras?", "Choice1", "Choice2"],
  ["air_supported_structure", "Fire alarm?", "Choice1", "Choice2"],
  ["incident_reports", "Air supported structure?", "Choice1", "Choice2"],
  ["playground_equipment", "Incident reports?", "Choice1", "Choice2"],
  ["onsite_child_care", "Child care services?", "Choice1", "Choice2"],
  ["tanning_beds", "Tanning beds?", "Choice3", "Choice4"],
  ["spa_massage", "Spa services?", "Choice5", "Choice6"],
  ["sauna", "Sauna?", "Choice7", "Choice8"],
  ["sports_medicine", "Sports medicines?", "Choice5", "Choice6"],
  ["physical_occupational_therapy", "Physical therapy?", "Choice7", "Choice8"],
  ["professional_athlete_training", "Professional athlete training?", "Choice5", "Choice6"],
  ["licensed_daycare", "Daycare facilities?", "Choice7", "Choice8"],
  ["unsupervised_24_hour", "24 hour facilities?", "Choice7", "Choice8"],
];

/** "What kind of sport do you train?": three columns of seven, numbered across the rows. */
export const FITNESS_SPORTS: string[][] = [
  ["Aerobics", "Barre", "Boot Camp", "Bungee Fitness", "Cardio Boxing", "Cardio Kickboxing", "Circuit Training"],
  ["CrossCore", "Indoor Cycling", "High Intensity Interval Training", "Jump Rope", "Pilates", "Spinning", "Stretching"],
  ["Strength Training", "T'ai Chi", "Total Resistance Exercises", "Yoga", "Weights", "Zumba", "Other"],
];
const SPORT_BOXES: Record<string, string> = Object.fromEntries(
  FITNESS_SPORTS.flatMap((col, c) => col.map((sport, r) => [sport, `Check Box ${r * 3 + c + 1}`])),
);

const OPERATION: Record<string, string> = {
  Corporation: "Choice1",
  "Individual/Sole Proprietor": "Choice2",
  "Partnership/Joint Venture": "Choice3",
  "Limited Liability Company (LLC)": "Choice4",
  Other: "Choice5",
};

const AGGREGATE: Record<string, string> = {
  "$1,000,000": "1",
  "$2,000,000": "1.05",
  "$3,000,000": "1.10",
  "$4,000,000": "1.15",
  "$5,000,000": "1.20",
};

const HNOA: Record<string, string> = {
  "$250,000 for an additional $250.00": "250",
  "$500,000 for an additional $500.00": "500",
  "No, thank you.": "0",
};
const MED_PAY: Record<string, string> = { "$10,000 for an additional 5% of Your Premium Rate": "0.05", "No, thank you.": "0" };
const ABUSE: Record<string, string> = { "$100,000 / $300,000 for an additional $500.00": "500", "No, thank you.": "0" };
const ENCLOSED: Record<string, string> = { "my payment for the total premium": "full", "20% of my total premium": "20%" };
const PAYMENT_METHOD: Record<string, string> = { ACH: "0", "Credit Card": "1", Check: "2" };

/** Web form relationship → the PDF dropdown's option. */
const RELATIONSHIP: Record<string, string> = {
  "L - Landlord": "L",
  "V - Venue": "V",
  "E - Event Operator": "E",
  "F - Franchisor/Franchise Owner": "F",
  "G - Governmental Agency": "G",
  "IC - Independent Contractor (Cost: $75)": "IC (Cost: $75)",
};

const STATE_NAMES: Record<string, string> = {
  AL: "Alabama", AK: "Alaska", AZ: "Arizona", AR: "Arkansas", CA: "California", CO: "Colorado", CT: "Connecticut",
  DE: "Delaware", DC: "District of Columbia", FL: "Florida", GA: "Georgia", HI: "Hawaii", ID: "Idaho", IL: "Illinois",
  IN: "Indiana", IA: "Iowa", KS: "Kansas", KY: "Kentucky", LA: "Louisiana", ME: "Maine", MD: "Maryland",
  MA: "Massachusetts", MI: "Michigan", MN: "Minnesota", MS: "Mississippi", MO: "Missouri", MT: "Montana",
  NE: "Nebraska", NV: "Nevada", NH: "New Hampshire", NJ: "New Jersey", NM: "New Mexico", NY: "New York",
  NC: "North Carolina", ND: "North Dakota", OH: "Ohio", OK: "Oklahoma", OR: "Oregon", PA: "Pennsylvania",
  RI: "Rhode Island", SC: "South Carolina", SD: "South Dakota", TN: "Tennessee", TX: "Texas", UT: "Utah",
  VT: "Vermont", VA: "Virginia", WA: "Washington", WV: "West Virginia", WI: "Wisconsin", WY: "Wyoming",
};

/** "2026-11-01" → "11/01/2026", the PDF's date format. */
const usDate = (iso: string) => iso.replace(/^(\d{4})-(\d{2})-(\d{2})$/, "$2/$3/$1");

/** A single-choice answer onto a radio group; an answer with no matching button goes on the addendum. */
function choice(f: Filler, id: string, group: string, label: string, buttons: Record<string, string>) {
  const v = f.get(id);
  if (buttons[v]) f.radio(group, buttons[v]);
  else f.note(label, v);
}

function additionalInsureds(f: Filler) {
  const counts = { primary: 0, waiver: 0 };
  for (const n of [1, 2, 3]) {
    const g = (k: string) => f.get(`ai_${n}_${k}`);
    if (!g("name")) continue;
    f.set(`Name Email ${n}`, [g("name"), g("email")].filter(Boolean).join(", "), `Additional insured #${n} name and email`);
    f.set(`Mailing Address ${n}`, g("address"), `Additional insured #${n} mailing address`);
    const relationship = g("relationship");
    if (RELATIONSHIP[relationship]) f.dropdown(`Relationship ${n}`, RELATIONSHIP[relationship], `Additional insured #${n} relationship`);
    else f.note(`Additional insured #${n} relationship`, relationship);
    const endorsements = f.list(`ai_${n}_endorsements`);
    if (endorsements.some((e) => e.startsWith("Primary"))) {
      f.check(`Primary ${n}`);
      counts.primary++;
    }
    if (endorsements.some((e) => e.startsWith("Waiver"))) {
      f.check(`Waiver ${n}`);
      counts.waiver++;
    }
  }
  // The PDF adds these up itself in Acrobat; filled here so a printed copy shows them too.
  f.set("Primary Number", String(counts.primary), "Primary non-contributory endorsements");
  f.set("Waiver Number", String(counts.waiver), "Waiver of subrogation endorsements");
  // The PDF counts additional insureds marked IC; the web form asks for the number of
  // independent contractors directly, which can be more than three.
  f.set("IC Number", f.get("independent_contractors").replace(/\D/g, ""), "Independent contractors");
}

export const fitnessCarrierForm: CarrierFormSpec = {
  formSlugs: ["fitness-facility-application"],
  name: "Carrier application (Fitness CTF 2/28/2023)",
  template: "dsi-ctf-fitness-2023.pdf",
  // Page 4: "Signed for the Proposed Policyholder" box runs x 18–182, y 150–171; its Date box is a field.
  signature: { page: 3, x: 22, y: 151, width: 156, height: 19 },
  signatureField: "Proposed Policyholder",
  templateLook: true,
  // No `blanks`: the premium, payment and card boxes must stay empty, so the
  // mapping writes N/A into the few boxes a skipped question leaves.

  map(_values, f) {
    // ── Page 1: Proposed Policyholder Information
    f.answer("Full Legal Name of Proposed Policyholder", "legal_business_name", "Full legal name of proposed policyholder");
    choice(f, "type_of_operation", "Type of Operation", "Type of operation", OPERATION);
    f.answer("Other", "type_of_operation_other", "Type of operation (other)", "N/A");
    f.set("business.Business Name 2", f.get("operating_under_dba") === "Yes" ? f.get("dba") : "N/A", "Doing business as");
    f.answer("Full Mailing Address", "mailing_address", "Mailing address");
    f.answer("City", "mailing_city", "Mailing city");
    const state = f.get("mailing_state");
    if (STATE_NAMES[state]) f.dropdown("State", STATE_NAMES[state], "Mailing state");
    else f.note("Mailing state", state);
    f.answer("Zip", "mailing_postal_code", "Mailing ZIP");
    f.set("Contact Name", [f.get("first_name"), f.get("last_name")].filter(Boolean).join(" "), "Contact name");
    f.answer("Phone Number", "phone", "Phone number");
    f.answer("Email Address", "email", "Email address");
    f.set("Requested Effective Date_af_date", usDate(f.get("requested_effective_date")), "Requested effective date");

    // ── Pages 1–2: Yes/No questions
    for (const [id, group, yes, no] of FITNESS_YES_NO) f.yesNoRadio(id, group, yes, no);
    f.set("Claims paid", f.get("claims_paid_3yrs") === "Yes" ? f.get("claims_description") : "N/A", "Claims paid in the last 3 years");
    f.set("Annual gross receipt", formatCurrency(f.get("annual_gross_receipts")), "Annual gross receipts");
    f.option("sports_trained", "Sports trained", SPORT_BOXES);
    f.answer("Other Style 3", "sports_trained_other", "Sports trained (other)", "N/A");

    // ── Page 3: premium calculator and optional coverages
    choice(f, "general_liability_aggregate", "General Aggregate", "General liability aggregate", AGGREGATE);
    f.set("Number of Participants", f.get("number_of_participants").replace(/[^\d]/g, ""), "Number of participants");
    choice(f, "hnoa_coverage", "HNOA Radio", "Hired and non-owned automobile liability", HNOA);
    choice(f, "medical_payment", "MedBenefit Radio", "Medical payment", MED_PAY);
    choice(f, "abuse_molestation_coverage", "Abuse radio", "Abuse or molestation liability", ABUSE);
    additionalInsureds(f);

    // ── Page 4: payment and signature (card and bank details are collected by the agency)
    choice(f, "payment_amount", "Enclosed is?", "Enclosed is", ENCLOSED);
    choice(f, "payment_method", "Payment Method", "Payment method", PAYMENT_METHOD);
    f.set("Date", usDate(f.get("signature_date")), "Date signed");
  },
};
