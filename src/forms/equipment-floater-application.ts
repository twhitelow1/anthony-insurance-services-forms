import { is, isYes, money, opts, text, US_STATES, yesNo } from "@/lib/forms/helpers";
import type { FormDefinition, FormValues } from "@/lib/forms/types";

/**
 * Sports, Leisure & Entertainment Equipment Floater application
 * (cameras, production gear, musical equipment, sports equipment).
 * Transcribed from the Lead Alchemist (GHL) form QtRy9zJIG8EanS6C4xyo, with
 * help text from the older website version at
 * https://anthonyinsuranceservices.com/forms/sports-leisure-entertainment-equipment-floater-application/.
 *
 * Answers are stored in the app's database. Only fields with `ghl.standard`
 * are copied to the GoHighLevel contact.
 */

const SHORT_TERM =
  "I need a SHORT-TERM POLICY (1 day to 11 months) coverage for RENTED Equipment (not including automobiles)";
const ANNUAL =
  "I need an ANNUAL POLICY to cover at least one of the following Equipment types: Owned Production Equipment, Owned Sports, Leisure & Recreation Equipment, Owned Musical Instruments & Sound Equipment, Business Personal Property, Tenant Improvements & Betterments, Rented Equipment from Others";

const isShortTerm = is("policy_term", SHORT_TERM);
const isAnnual = is("policy_term", ANNUAL);
const annualAnd = (pred: (v: FormValues) => boolean) => (v: FormValues) => isAnnual(v) && pred(v);
const wantsBusinessIncome = annualAnd(is("business_income", "Limit Requested"));

const EQUIPMENT_TYPES: { id: string; label: string; descLabel: string; tooltip: string }[] = [
  {
    id: "owned_production",
    label: "Owned Production Equipment",
    descLabel: "Owned Production Equipment Description",
    tooltip:
      "Cameras, camera equipment, sound, audio visual, lighting and grip equipment, communications equipment, portable electric equipment, editing and projection equipment, office personal property, generators, mechanical effects equipment, props, sets, wardrobe, event equipment, theatrical equipment, computer equipment including desktops, laptops and monitors, and all similar personal property and related production and entertainment equipment.",
  },
  {
    id: "owned_sports",
    label: "Owned Sports, Leisure & Recreational Equipment",
    descLabel: "Owned Sports, Leisure & Recreational Equipment Description",
    tooltip:
      "Sporting goods and equipment, gym and fitness equipment, business personal property, tenant improvements, sport event property, race timing machines, racing chips, banners, office personal property, ROTC related equipment, and any related Sports & Recreational equipment.",
  },
  {
    id: "tenant_improvements",
    label: "Tenant Improvements & Betterments",
    descLabel: "Tenant Improvements & Betterments Description",
    tooltip:
      "Fixtures, alterations, installations, or additions that become part of a building that you do not own and cannot be legally removed. The tenant improvements and betterments were paid by you and had them installed or personally installed. This does not cover any landlord improvements to the rented space.",
  },
  {
    id: "business_personal_property",
    label: "Business Personal Property",
    descLabel: "Business Personal Property Description",
    tooltip: "Office Furniture, lockers, rugs, lamps, telephones any other similar business personal property.",
  },
  {
    id: "owned_musical",
    label: "Owned Musical Instruments & Sound Equipment",
    descLabel: "Owned Musical Instruments & Sound Equipment Description",
    tooltip:
      "Musical Instruments, sound equipment, vintage musical instruments, similar personal property, office personal property, and other related musical equipment.",
  },
  {
    id: "rented_from_others",
    label: "Rented Equipment from Others (Maximum value at any one time)",
    descLabel: "Rented Equipment from Others Description",
    tooltip: "Any of the above equipment classes rented for use not including tenant betterments and improvements.",
  },
];

export const equipmentFloaterApplication: FormDefinition = {
  slug: "equipment-floater-application",
  title: "Sports, Leisure & Entertainment Equipment Floater Application",
  subtitle: "Equipment floater coverage for cameras, production gear, musical and sports equipment",
  tags: ["form:equipment-floater-application", "equipment"],
  source: "Anthony Insurance Forms — Sports, Leisure & Entertainment Equipment Floater Application",
  successMessage:
    "Thank you! Your application has been submitted. An Anthony Insurance Services agent will review it and reach out shortly.",
  sections: [
    {
      id: "policy_holder",
      title: "Policyholder Information",
      fields: [
        text("legal_business_name", "Full Legal Name of Policy Holder", {
          required: true,
          hint: "As it should appear on insurance policy",
          ghl: { standard: "companyName" },
        }),
        text("first_name", "First Name", { required: true, width: "half", ghl: { standard: "firstName" } }),
        text("last_name", "Last Name", { required: true, width: "half", ghl: { standard: "lastName" } }),
        { type: "email", id: "email", label: "Email", required: true, width: "half", ghl: { standard: "email" } },
        { type: "tel", id: "phone", label: "Phone", required: true, width: "half", ghl: { standard: "phone" } },
        { type: "url", id: "website", label: "Website", placeholder: "www.example.com", width: "half", ghl: { standard: "website" } },
        { type: "tel", id: "fax", label: "Fax", width: "half" },
        { type: "content", id: "mailing_heading", variant: "subheading", title: "Address" },
        text("mailing_address", "Street Address", { ghl: { standard: "address1" } }),
        text("mailing_city", "City", { width: "half", ghl: { standard: "city" } }),
        { type: "select", id: "mailing_state", label: "State", options: US_STATES, width: "half", ghl: { standard: "state" } },
        text("mailing_country", "Country", { width: "half", placeholder: "United States" }),
        text("mailing_postal_code", "Postal Code", { width: "half", ghl: { standard: "postalCode" } }),
      ],
    },
    {
      id: "operations",
      title: "Business Operations & Equipment",
      fields: [
        { type: "textarea", id: "business_operation", label: "Please describe your business operation", required: true },
        yesNo("equipment_claim_5yrs", "Have you ever had an equipment claim in the last 5 years?"),
        {
          type: "content",
          id: "claims_instructions",
          variant: "info",
          body: "Please describe all claims including date, payout, and loss details.",
          showIf: isYes("equipment_claim_5yrs"),
        },
        { type: "textarea", id: "claim_1", label: "Claim #1", showIf: isYes("equipment_claim_5yrs") },
        { type: "textarea", id: "claim_2", label: "Claim #2", showIf: isYes("equipment_claim_5yrs") },
        { type: "textarea", id: "claim_3", label: "Claim #3", showIf: isYes("equipment_claim_5yrs") },
        text("storage_location", "Where do you store your equipment the majority of time?", { required: true }),
        yesNo("alarm_monitored", "Does this place have an alarm system connected to an outside monitoring company?"),
        yesNo("travel_outside_us", "Do you travel with your equipment outside the United States more than 5 times per year?"),
        yesNo("travel_mexico", "Do you ever travel with your equipment to Mexico?"),
        yesNo("equipment_under_water", "Does any of your equipment go under water?"),
        yesNo("waterproof_case", "Is it in a waterproof protective case?", {
          required: false,
          showIf: isYes("equipment_under_water"),
        }),
      ],
    },
    {
      id: "policy_term",
      title: "Policy Term",
      fields: [
        {
          type: "radio",
          id: "policy_term",
          label: "Please select one of the following coverage options:",
          options: opts(SHORT_TERM, ANNUAL),
          required: true,
        },
        {
          type: "content",
          id: "short_term_heading",
          variant: "subheading",
          title: "Short-Term Coverage: Policy Terms 1 Day to 11 Months - Rented Equipment Coverage Only (No Automobiles)",
          showIf: isShortTerm,
        },
        money("short_term_rented_limit", "Rented Equipment from Others Limit", {
          hint: "Replacement Value, including sales tax, of all equipment being rented",
          showIf: isShortTerm,
        }),
        { type: "date", id: "rental_pick_up_date", label: "Rental Pick Up Date", width: "half", showIf: isShortTerm },
        { type: "date", id: "rental_return_date", label: "Rental Return Date", width: "half", showIf: isShortTerm },
        { type: "textarea", id: "short_term_rented_description", label: "Description of equipment being rented", showIf: isShortTerm },
        {
          type: "radio",
          id: "short_term_continuing_rental_fees",
          label: "Continuing Rental Fees Coverage",
          options: opts("None", "$2,500", "$5,000"),
          tooltip:
            "If you have a covered claim, this coverage reimburses your rental company for loss of rental income during your claim handling. This coverage has a 72 hour waiting period from the time the claim is reported in writing to the insurance agent or carrier.",
          showIf: isShortTerm,
        },
        yesNo(
          "short_term_remove_locked_vehicle_warranty",
          "Currently the policy has a Locked Vehicle Warranty. This means there is no coverage for theft from an UNLOCKED vehicle unless you elect to remove this warranty for an additional 10% of the premium. Would you like to remove this warranty for an additional 10% charge?",
          { required: false, showIf: isShortTerm },
        ),
        {
          type: "content",
          id: "annual_heading",
          variant: "info",
          title: "Annual Coverage: Policy Term 12 Months - All Eligible Coverages and Options Available (No Automobiles)",
          body: "Complete the equipment limits and optional coverages on the next pages.",
          showIf: isAnnual,
        },
      ],
    },
    {
      id: "annual_limits",
      title: "Annual Coverage — Equipment Limits",
      description: "1. Please complete. At least one limit is required below.",
      fields: [
        {
          type: "content",
          id: "annual_limits_na",
          variant: "info",
          body: "This section applies to Annual policies only. Continue to the next step.",
          showIf: (v) => !isAnnual(v),
        },
        {
          type: "content",
          id: "equipment_chart_instructions",
          variant: "info",
          body: [
            "Replacement Value (Include sales tax) — If none, enter 0.",
            'Description of Equipment — If none, please type "NA".',
          ],
          showIf: isAnnual,
        },
        ...EQUIPMENT_TYPES.flatMap((t) => [
          { type: "content" as const, id: `${t.id}_heading`, variant: "subheading" as const, title: t.label, showIf: isAnnual },
          money(`${t.id}_value`, `${t.label} — Replacement Value`, {
            required: true,
            width: "half",
            tooltip: t.tooltip,
            placeholder: "0",
            showIf: isAnnual,
          }),
          text(`${t.id}_description`, t.descLabel, { required: true, width: "half", placeholder: "NA", showIf: isAnnual }),
        ]),
      ],
    },
    {
      id: "annual_questions",
      title: "Annual Coverage — Rentals & Scheduled Items",
      fields: [
        {
          type: "content",
          id: "annual_questions_na",
          variant: "info",
          body: "This section applies to Annual policies only. Continue to the next step.",
          showIf: (v) => !isAnnual(v),
        },
        { type: "content", id: "q2_heading", variant: "subheading", title: "2.", showIf: isAnnual },
        yesNo(
          "rent_to_others",
          "Do you rent any of your owned equipment to the sole custody of others (unaccompanied by you or your employees)?",
          { required: false, showIf: isAnnual },
        ),
        money(
          "max_value_rented_out",
          "What is the maximum replacement value of owned equipment that you rent out to others at any one time(unaccompanied by you or your employees)?",
          { showIf: annualAnd(isYes("rent_to_others")) },
        ),
        { type: "content", id: "q3_heading", variant: "subheading", title: "3.", showIf: isAnnual },
        yesNo("voluntary_parting", "Would you like to add coverage for Voluntary Parting and False Pretense?", {
          required: false,
          tooltip: "This covers your equipment if the person/company renting or borrowing your equipment never returns it.",
          showIf: isAnnual,
        }),
        yesNo(
          "renters_sign_contract",
          "Do you require your renters to sign a rental contract that makes them responsible for damages or theft to your equipment being rented?",
          { required: false, showIf: isAnnual },
        ),
        { type: "content", id: "q4_heading", variant: "subheading", title: "4.", showIf: isAnnual },
        yesNo("single_item_5001", "For equipment you own, is any single item valued at $5,001 or more (replacement cost including sales tax)?", {
          required: false,
          showIf: isAnnual,
        }),
        yesNo("scheduled_items_in_limits", "Is the equipment value included in the limits you entered into the Equipment Type Chart (Question 1)?", {
          required: false,
          showIf: annualAnd(isYes("single_item_5001")),
        }),
        {
          type: "table",
          id: "scheduled_items",
          label: "Single Items Valued at $5,001 or More",
          description:
            "Please list below ALL single items valued at $5,001 or more showing Make, Model, Serial #, and Replacement Cost (including sales tax). Owned items that are valued at $5,001 or more that are not listed will not be covered under the policy.",
          maxRows: 10,
          columns: [
            { id: "make", label: "Make", type: "text" },
            { id: "model", label: "Model", type: "text" },
            { id: "serial", label: "Serial #", type: "text" },
            { id: "replacement_cost", label: "Replacement Cost (incl. sales tax)", type: "number" },
          ],
          showIf: annualAnd(isYes("single_item_5001")),
        },
      ],
    },
    {
      id: "annual_optional",
      title: "Annual Coverage — Optional Coverages",
      fields: [
        {
          type: "content",
          id: "annual_optional_na",
          variant: "info",
          body: "This section applies to Annual policies only. Continue to the next step.",
          showIf: (v) => !isAnnual(v),
        },
        {
          type: "radio",
          id: "rental_reimbursement",
          label: "5. Rental Reimbursement Coverage - only available with Owned Equipment Coverage",
          options: opts("None", "$2,500", "$5,000", "$10,000", "$25,000"),
          tooltip: "If you have a covered claim, this coverage reimburses your rental fees for equipment rented to continue your business operations.",
          showIf: isAnnual,
        },
        {
          type: "radio",
          id: "continuing_rental_fees",
          label: "6. Continuing Rental Fees Coverage. Only available with Rented Equipment from Others Coverage",
          options: opts("None", "$2,500", "$5,000", "$10,000", "$25,000"),
          tooltip:
            "If you have a covered claim, this coverage reimburses your rental company for loss of rental income during your claim handling. This coverage has a 72 hour time deductible from the time the claim is reported in writing to the insurance agent or carrier.",
          showIf: isAnnual,
        },
        {
          type: "radio",
          id: "work_tools_clothing",
          label: "7. Work Tools and Clothing. Coverage options are per occurrence/per employee limits.",
          options: opts("None", "$1,000/$250", "$5,000/$500", "$10,000/$1,000"),
          tooltip: "This coverage is a separate limit for work related tools and clothing, such as work uniforms",
          showIf: isAnnual,
        },
        {
          type: "radio",
          id: "plate_glass",
          label: "8. Interior/Exterior Plate Glass Coverage.",
          options: opts("None", "$5,000 (additional premium $50.00)"),
          tooltip: "This covers exterior or interior plate glass installed by either you or your landlord at your business location.",
          showIf: isAnnual,
        },
        {
          type: "radio",
          id: "business_income",
          label: "9. Business Income and Extra Expense (other than rental value).",
          options: opts("None", "Limit Requested"),
          tooltip:
            "This covers the loss of business income and extra expenses as a result of a covered claim. This does NOT include 'rental value' which is loss of rental income your landlord incurs. This optional coverage is tied to the scheduled location only, which means the claim has to occur at the scheduled location.",
          showIf: isAnnual,
        },
        money("business_income_limit", "Enter Limit (Maximum Limit $50,000):", {
          required: true,
          max: 50000,
          width: "half",
          hint: "Please enter a number less than or equal to 50000.",
          showIf: wantsBusinessIncome,
        }),
        {
          type: "content",
          id: "business_income_locations_heading",
          variant: "subheading",
          title: "Please schedule the location(s) for the requested Business Income Coverage (description, location address, city, state, zip):",
          showIf: wantsBusinessIncome,
        },
        text("business_income_location_1", "Location 1:", { required: true, showIf: wantsBusinessIncome }),
        text("business_income_location_2", "Location 2:", { showIf: wantsBusinessIncome }),
        {
          type: "checkboxes",
          id: "business_income_location_ack",
          label: "I understand that Business Income and Extra Expense is tied to a scheduled location",
          options: opts(
            "I understand that Business Income and Extra Expense is tied to a scheduled location, which means the claim has to occur at the location(s) listed above.",
          ),
          required: true,
          showIf: wantsBusinessIncome,
        },
        {
          type: "checkboxes",
          id: "business_continuation_plan_ack",
          label: "Business Continuation Plan",
          tooltip:
            "A business continuation plan would be a written document with a plan of action to get your business up and running to minimize down time based on the following 4 key elements. 1-Office Space. 2-Power for this Space. 3-Connectivity (internet/phone). 4-Technology/Hardware Systems.",
          options: opts("I understand a Business Continuation Plan must be received in order to bind this coverage."),
          required: true,
          showIf: wantsBusinessIncome,
        },
        {
          type: "checkboxes",
          id: "business_income_waiting_period_ack",
          label: "Waiting Period",
          options: opts(
            "I understand a 72 hour waiting period applies for Business Income and Extra Expense Coverage. In the states of AL, CT, DE, FL, GA, LA, MA, MD, ME, MS, NH, NJ, NY, NC, RI, SC, TX, and VA, the waiting period is increased to 120 hours.",
          ),
          required: true,
          showIf: wantsBusinessIncome,
        },
        { type: "content", id: "locked_vehicle_heading", variant: "subheading", title: "10. Locked Vehicle Warranty", showIf: isAnnual },
        yesNo(
          "remove_locked_vehicle_warranty",
          "This policy has a Locked Vehicle Warranty, which states there is NO coverage for equipment stolen from an Unlock vehicle. Do you wan to remove this warranty and thus add back coverage for equipment stolen from an Unlock vehicle for an additional 10% charge?",
          { required: false, showIf: isAnnual },
        ),
      ],
    },
    {
      id: "additional_info",
      title: "Additional Information",
      fields: [text("how_heard", "How did you hear about us?", { required: true })],
    },
    {
      id: "signature",
      title: "Disclaimers & Signature",
      fields: [
        {
          type: "content",
          id: "disclaimers",
          variant: "notice",
          body: [
            "I understand that this quote is for equipment coverage and does not apply to vehicles, liability insurance, or workers compensation coverage.",
            "I understand that if I take my equipment to the country of Mexico, there is an automatic sub-limit (cap of coverage) of $25,000 total.",
            "I understand that coverage is worldwide except for countries with US Sanctions.",
            "I Understand that minimum premium is fully earned at policy inception.",
            "I understand that if the policy is cancelled, all minimum premium is fully earned and will not be refunded.",
            "I understand that my policy has a LOCKED VEHICLE WARRANTY. This means that there is no coverage for theft from an UNLOCKED vehicle unless I elect to remove this warranty for an additional 10% of my premium.",
            "I have reviewed and understand the above statements. I certify that the information provided is true and accurate to the best of my knowledge. I understand that providing false information may affect my coverage and even void coverage in the event of a claim.",
          ],
        },
        text("applicant_name", "Applicant Name", { required: true, width: "half" }),
        { type: "signature", id: "signature", label: "Applicant's Signature", required: true },
      ],
    },
  ],
};
