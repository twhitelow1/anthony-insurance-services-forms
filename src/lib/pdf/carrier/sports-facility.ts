import { tableCellId, tableRowCountId } from "@/lib/forms/types";
import { clampRows } from "@/lib/forms/validate";
import type { CarrierFormSpec, Filler } from "./types";

/**
 * Sports Team / League / Association / Facility Application, SFIC-STL-APP-001 (04/2026).
 * Field names are the PDF's own AcroForm names. They're generic ("Yes_20"), so each one
 * is listed next to the question it sits beside on the page.
 *
 * When the carrier sends a new version: replace the template file, re-run the field
 * dump (see README), and update the names below. The test fails on any name the
 * template doesn't have.
 */

const M = 1_000_000;
const K = 1_000;

/** Underwriting questions on page 3, in page order: Yes_172/No_173 … Yes_208/No_209. */
const UNDERWRITING = [
  "players_compensated",
  "school_sanctioned",
  "residential_property",
  "adult_participants_defined",
  "cardiac_policy",
  "severe_weather_policy",
  "heat_index_policy",
  "pool_activities",
  "facilities_safety_policy",
  "concussion_policy",
  "disciplinary_policy",
  "background_checks_policy",
  "abuse_training_policy",
  "sexual_abuse_incident",
  "abuse_prevention_standards",
  "policies_published",
  "one_on_one_policy",
  "online_reporting_form",
  "prohibited_behavior_defined",
];

const AGES = ["u12", "a13_15", "a16_18", "a19"];

function locations(f: Filler) {
  const count = Math.min(Math.max(Number(f.get("location_count")) || 0, 0), 5);
  const all = Array.from({ length: count }, (_, i) => i + 1);
  const primary = Number(f.get("primary_location").replace(/\D/g, "")) || 1;
  // The primary location goes first; the PDF has room for two.
  const order = [primary, ...all.filter((n) => n !== primary)].filter((n) => n <= count);
  const describe = (n: number) => {
    const g = (k: string) => f.get(`location_${n}_${k}`);
    return { street: g("street"), city: g("city"), state: g("state"), zip: g("zip") };
  };

  if (order.length) f.check("Yes_32"); // "Is this your primary location?" — the first slot is.
  // Location Name (Location_Name:_34 / _39) isn't asked on the web form.
  const slots = [
    ["Address:_35", "City:_36", "State:_37", "Zip_Code:_38"],
    ["Address:_40", "City:_41", "State:_42", "Zip_Code:_43"],
  ];
  order.slice(0, 2).forEach((n, i) => {
    const loc = describe(n);
    const [street, city, state, zip] = slots[i];
    const label = i === 0 ? "Primary location" : "Additional location";
    f.set(street, loc.street, `${label} address`);
    f.set(city, loc.city, `${label} city`);
    f.set(state, loc.state, `${label} state`);
    f.set(zip, loc.zip, `${label} ZIP`);
  });
  order.slice(2).forEach((n) => {
    const loc = describe(n);
    f.note(
      `Additional location (Location #${String(n).padStart(2, "0")})`,
      [loc.street, [loc.city, loc.state, loc.zip].filter(Boolean).join(", ")].filter(Boolean).join(" — "),
    );
  });
}

function table(f: Filler, tableId: string, cols: string[], maxRows: number, firstIndex: number, labels: string[]) {
  const rows = Math.min(clampRows(f.get(tableRowCountId(tableId)) || "1", maxRows), maxRows);
  for (let r = 0; r < rows; r++) {
    cols.forEach((col, c) => {
      const n = firstIndex + r * cols.length + c;
      f.set(`g${r}c${c}_${n}`, f.get(tableCellId(tableId, r + 1, col)), `${labels[c]} (row ${r + 1})`);
    });
  }
}

export const sportsFacilityCarrierForm: CarrierFormSpec = {
  // Gymnastics and boxing gyms apply on the same carrier form (the website's
  // "PH app" PDF and the Lead Alchemist gymnastics / boxing widgets).
  formSlugs: ["sports-facility-application", "gymnastics-application", "boxing-gym-application"],
  name: "Carrier application (SFIC-STL-APP-001)",
  template: "sfic-stl-app-001.pdf",
  // Page 5: signature line runs x 40–333 at 256pt from the bottom; date line x 370–572.
  signature: { page: 4, x: 44, y: 258, width: 285, height: 30 },
  date: { page: 4, x: 374, y: 260 },
  blanks: {
    // Every Yes/No question on this PDF is a "Yes_<n>" box followed by "No_<n+1>".
    yesNoPair: /^Yes_(\d+)$/,
    keepBlank: [
      /^g\d+c\d+_\d+$/, // participant / camp table cells: empty rows stay empty
      /^(Yes_131|No_132)$/, // "If either above is 'No', do you agree…": a default "No" would read as refusing
      /^Title:_295$/, // the signer's title isn't asked; leave room to write it in
    ],
  },

  map(values, f) {
    // ── Section 1: Applicant information
    const dba = /^(n\/?a|none|-)$/i.test(f.get("dba")) ? "" : f.get("dba");
    f.set("Applicant_Name:_1", [f.get("legal_business_name"), dba && `DBA ${dba}`].filter(Boolean).join(" "), "Applicant name");
    f.answer("Email_Address:_2", "email", "Email address");
    f.answer("Phone:_3", "phone", "Phone");
    f.answer("Website:_4", "website", "Website");
    f.answer("Mailing_Address:_5", "mailing_address", "Mailing address");
    f.answer("City:_6", "mailing_city", "Mailing city");
    f.answer("State:_7", "mailing_state", "Mailing state");
    f.answer("Zip_Code:_8", "mailing_postal_code", "Mailing ZIP");
    f.yesNo("mailing_same_as_physical", "Yes_9", "No_10");

    // ── Section 2: Business information
    f.option("business_entity", "Form of business", {
      LLC: "LLC_11",
      Individual: "Individual_12",
      Partnership: "Partnership_13",
      "Joint Venture": "Joint_Venture_14",
      Trust: "Trust_15",
      "Non-Profit": "Non-Profit_16",
    });
    f.answer("Business_Start_Year:_17", "business_start_year", "Business start year");
    f.answer("Business_Website:_18", "website", "Business website");
    const type = f.get("business_type");
    f.set("Business_Description:_19", [type && `${type}.`, f.get("business_description")].filter(Boolean).join(" "), "Business description");

    // ── Section 3: General questions
    f.yesNo("experience_5yrs", "Yes_20", "No_21");
    f.yesNo("waiver_forms", "Yes_22", "No_23");
    f.yesNo("prohibited_conduct_defined", "Yes_24", "No_25");
    f.yesNo("bankruptcy", "Yes_26", "No_27");
    f.yesNo("non_renewed", "Yes_28", "No_29");
    if (f.get("non_renewed") === "Yes") f.note("Non-renewal details (Section 3)", f.get("non_renewed_details"));
    f.yesNo("claim_over_25k", "Yes_30", "No_31");

    // ── Section 4: Locations
    locations(f);

    // ── Section 5: Participants (5 rows) and camps (3 rows)
    table(f, "activities", ["name", ...AGES, "coaches"], 5, 44, ["Sport / Activity", "12 & Under", "13-15", "16-18", "19+", "Coaches"]);
    table(f, "camps", ["name", "days", ...AGES], 3, 74, ["Camp sport / activity", "# Camp/Clinic Days", "12 & Under", "13-15", "16-18", "19+"]);
    // Overnight events (Yes_92/No_93, nights_94) aren't asked on the web form; left blank.

    // ── Section 6: General liability limits
    f.amount("occurrence_limit", "Each occurrence limit", [[1 * M, "$1M_95"], [1.5 * M, "$1.5M_96"], [2 * M, "$2M_97"], [3 * M, "$3M_98"], [4 * M, "$4M_99"], [5 * M, "$5M_100"]]);
    f.yesNo("occurrence_contract_requirement", "Yes_101", "No_102");
    f.amount("products_completed_ops_limit", "Products & completed operations limit", [[1 * M, "$1M_103"], [2 * M, "$2M_104"]]);
    f.amount("general_aggregate_limit", "General aggregate limit", [[3 * M, "$3M_105"], [4 * M, "$4M_106"], [5 * M, "$5M_107"]]);
    f.amount("damage_to_premises_limit", "Damage to premises rented limit", [[300 * K, "$300K_108"], [500 * K, "$500K_109"], [1 * M, "$1M_110"]]);
    f.amount("medical_payment_max", "Medical payments limit", [[5 * K, "$5K_111"], [10 * K, "$10K_112"], [15 * K, "$15K_113"], [25 * K, "$25K_114"]], "N_A_115");
    f.pair(
      "sexual_abuse_limit",
      "Sexual abuse liability limit",
      [
        [25 * K, 100 * K, "$25K_$100K_116"],
        [50 * K, 100 * K, "$50K_$100K_117"],
        [100 * K, 300 * K, "$100K_$300K_118"],
        [500 * K, 500 * K, "$500K_$500K_119"],
        [1 * M, 1 * M, "$1M_$1M_120"],
        [1 * M, 2 * M, "$1M_$2M_121"],
      ],
      "N_A_122",
    );

    // Hired / non-owned auto
    f.yesNo("hnoa", "Yes_123", "No_124");
    const hnoa = f.get("hnoa") === "Yes";
    f.yesNo("commercial_auto_in_force", "Yes_125", "No_126");
    f.yesNo("verify_personal_auto", "Yes_127", "No_128");
    f.yesNo("review_mvrs", "Yes_129", "No_130");
    f.yesNo("agree_going_forward", "Yes_131", "No_132");
    f.answer("#_Employees_that_may_driv_133", "employees_drive", "# Employees that may drive", hnoa ? undefined : "N/A");
    f.answer("#_Volunteers_that_may_dri_134", "volunteers_drive", "# Volunteers that may drive", hnoa ? undefined : "N/A");
    f.set("Estimated_cost_to_lease_h_135", f.get("hired_vehicle_cost").replace(/^\$\s*/, "") || (hnoa ? "" : "N/A"), "Estimated cost to lease/hire vehicles");

    // Professional liability: Yes/No, then a single limit that applies to both halves ($1M → $1M/$1M).
    const professional = [[1, "$1M_$1M_136"], [2, "$2M_$2M_137"], [3, "$3M_$3M_138"], [4, "$4M_$4M_139"], [5, "$5M_$5M_140"]] as const;
    const proChoices = professional.map(([m, name]) => [m * M, m * M, name] as [number, number, string]);
    if (f.get("professional_liability") === "No") f.check("N_A_141");
    else f.pair("professional_occurrence_limit", "Professional liability limit", proChoices, "N_A_141");

    f.yesNo("employee_benefits", "Yes_142", "No_143");
    f.answer("Number_of_Employees:_144", "number_of_employees", "Number of employees", f.get("employee_benefits") === "No" ? "N/A" : undefined);
    f.yesNo("liquor_liability", "Yes_145", "No_146");
    f.set(
      "Liquor_Receipts:_$_147",
      f.get("liquor_receipts").replace(/^\$\s*/, "") || (f.get("liquor_liability") === "No" ? "N/A" : ""),
      "Liquor receipts",
    );
    f.yesNo("location_aggregate", "Yes_148", "No_149");
    f.yesNo("errors_omissions", "Yes_150", "No_151");
    f.amount("crisis_response", "Crisis response/protection limit", [[25 * K, "$25K_152"], [50 * K, "$50K_153"], [100 * K, "$100K_154"], [250 * K, "$250K_155"]]);
    f.yesNo("stop_gap", "Yes_156", "No_157");

    // ── Section 7: Accident & health
    f.yesNo("dental", "Yes_158", "No_159");
    f.amount("accident_medical_expense", "Accident medical expense", [[25 * K, "$25K_160"], [50 * K, "$50K_161"], [100 * K, "$100K_162"]]);
    // The web form tells applicants accident medical coverage is on an excess basis.
    if (f.get("accident_medical_expense")) f.check("Excess_163");
    f.amount("deductible", "Accident & health deductible", [
      [0, "$0_165"],
      [100, "$100_166"],
      [250, "$250_167"],
      [500, "$500_168"],
      [1 * K, "$1K_169"],
      [2.5 * K, "$2.5K_170"],
      [5 * K, "$5K_171"],
    ]);

    // ── Section 8: Underwriting
    UNDERWRITING.forEach((id, i) => f.yesNo(id, `Yes_${172 + i * 2}`, `No_${173 + i * 2}`));
    f.yesNo("transports_participants", "Yes_210", "No_211");
    f.option("transport_method", "Transportation method", {
      "Hired Transportation": "Hired_transportation_212",
      "Business Owned Vehicle(s)": "Business_owned_vehicle(s)_213",
      "Personal Vehicle(s)": "Personal_vehicle(s)_214",
    });
    f.yesNo("online_training", "Yes_215", "No_216");
    f.answer("Do_you_have_retail_sales?_217", "retail_sales", "Retail sales?");
    f.set(
      "Total_Retail_Receipts:_$_218",
      f.get("retail_receipts").replace(/^\$\s*/, "") || (f.get("retail_sales") === "No" ? "N/A" : ""),
      "Total retail receipts",
    );

    // ── Section 9: Additional exposures
    f.answer("#_Birthday_Parties:_219", "birthday_parties", "# Birthday parties");
    f.answer("#_Batting_Cages:_220", "batting_cages", "# Batting cages");
    f.answer("#_Booster_Clubs:_221", "booster_clubs", "# Booster clubs");
    f.answer("#_Inflatables:_222", "inflatables", "# Inflatables");
    f.answer("#_Tanning_Units:_223", "tanning_units", "# Tanning units");
    f.yesNo("soft_play", "Yes_224", "No_225");

    const none = (id: string) => (f.get(id) === "No" ? "0" : undefined);
    // The web form asks whether there are pools, not how many.
    if (f.get("has_pool") === "No") f.set("Number_of_Swimming_Pools:_226", "0", "Number of swimming pools");
    f.option("pool_depth", "Pool depth", { "4' or less": "4'_or_less_227", "5' or more": "5'_or_more_228" });
    (
      [
        ["pool_testing_daily", 229],
        ["pool_testing_logged", 231],
        ["pool_signage", 233],
        ["pool_nonslip", 235],
        ["pool_lifeguards", 237],
        ["pool_lifesaving_equipment", 239],
        ["pool_diving_board", 241],
        ["pool_water_slide", 243],
        ["pool_parents_present", 245],
      ] as const
    ).forEach(([id, n]) => f.yesNo(id, `Yes_${n}`, `No_${n + 1}`));

    f.answer("#_Traverse_Climbing_Walls_247", "climbing_wall_count", "# Traverse/climbing walls", none("has_climbing_walls"));
    f.answer("Height_(ft):_248", "climbing_wall_height", "Climbing wall height (ft)");
    f.yesNo("climbing_certified_rigger", "Yes_249", "No_250");
    f.yesNo("climbing_inspected", "Yes_251", "No_252");
    f.answer("Climbing_wall_instructor__253", "climbing_instructor_quals", "Climbing wall instructor qualifications/experience");
    f.yesNo("climbing_padding", "Yes_254", "No_255");
    f.yesNo("climbing_temp_structures", "Yes_256", "No_257");
    f.yesNo("climbing_self_made", "Yes_258", "No_259");

    const offered = values.aerial_offerings;
    const has = (o: string) => Array.isArray(offered) && offered.includes(o);
    (
      [
        ["Zip Lines", "ziplines", "#_Zip_Lines:_260", "Height_(ft):_261"],
        ["Ropes", "ropes", "#_Ropes:_262", "Height_(ft):_263"],
        ["Aerial Silks", "silks", "#_Aerial_Silks:_264", "Height_(ft):_265"],
        ["Trapezes", "trapezes", "#_Trapezes:_266", "Height_(ft):_267"],
      ] as const
    ).forEach(([option, id, countField, heightField]) => {
      if (has(option)) {
        f.answer(countField, `${id}_count`, `# ${option}`);
        f.answer(heightField, `${id}_height`, `${option} height (ft)`);
      } else {
        f.set(countField, "0", `# ${option}`);
      }
    });
    f.yesNo("aerial_certified_rigger", "Yes_268", "No_269");
    f.yesNo("aerial_inspected", "Yes_270", "No_271");
    f.answer("Ropes_silks_trapeze_instr_272", "aerial_instructor_quals", "Ropes/silks/trapeze instructor qualifications/experience");
    f.yesNo("aerial_padding", "Yes_273", "No_274");
    f.yesNo("aerial_temp_structures", "Yes_275", "No_276");
    f.yesNo("aerial_self_made", "Yes_277", "No_278");

    f.answer("Number_of_Trampolines:_279", "trampoline_count", "Number of trampolines", none("has_trampolines"));
    f.yesNo("trampoline_above_ground", "Yes_280", "No_281");
    f.yesNo("trampoline_padding", "Yes_282", "No_283");

    // ── Section 10: Additional insureds
    f.answer("Name:_284", "ai_landlord_name", "Additional insured (landlord) name");
    f.answer("Address:_285", "ai_landlord_address", "Additional insured (landlord) address");
    f.answer("City:_286", "ai_landlord_city", "Additional insured (landlord) city");
    f.answer("State:_287", "ai_landlord_state", "Additional insured (landlord) state");
    f.answer("Zip_Code:_288", "ai_landlord_zip", "Additional insured (landlord) ZIP");
    f.answer("Name:_289", "ai_other_name", "Additional insured (other) name");
    f.answer("Address:_290", "ai_other_address", "Additional insured (other) address");
    f.answer("City:_291", "ai_other_city", "Additional insured (other) city");
    f.answer("State:_292", "ai_other_state", "Additional insured (other) state");
    f.answer("Zip_Code:_293", "ai_other_zip", "Additional insured (other) ZIP");

    // ── Section 11: Signature
    // The person filling out the form signs it. Title isn't asked on the web form.
    f.set("Print_Name:_294", [f.get("first_name"), f.get("last_name")].filter(Boolean).join(" "), "Print name");

    // Not on the carrier's form, but the underwriter needs them.
    const effective = f.get("requested_effective_date").match(/^(\d{4})-(\d{2})-(\d{2})$/);
    f.note("Requested effective date", effective ? `${effective[2]}/${effective[3]}/${effective[1]}` : f.get("requested_effective_date"));
  },
};
