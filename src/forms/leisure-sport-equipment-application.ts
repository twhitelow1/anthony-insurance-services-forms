import { is, isYes, money, opts, text, US_STATES, yesNo } from "@/lib/forms/helpers";
import type { FormDefinition } from "@/lib/forms/types";

/**
 * Leisure & Sport Equipment (inland marine / equipment floater) application.
 * Transcribed from the Lead Alchemist form BQxQ2q2nDqbqUQrKOX9U
 * (linked from https://anthonyinsuranceservices.com/equipment/).
 *
 * Answers are stored in the app's database. Only fields with `ghl.standard`
 * are copied to the Lead Alchemist contact.
 */

const SHORT_TERM =
  "I need a SHORT-TERM POLICY (1 day to 11 months) coverage for RENTED Equipment (not including automobiles)";
const ANNUAL =
  "I need an ANNUAL POLICY to cover at least one of the following Equipment types: Owned Production Equipment, Owned Sports, Leisure & Recreation Equipment, Owned Musical Instruments & Sound Equipment, Business Personal Property, Tenant Improvements & Betterments, Rented Equipment from Others";

const isShortTerm = is("policy_term", SHORT_TERM);
const isAnnual = is("policy_term", ANNUAL);

export const leisureSportEquipmentApplication: FormDefinition = {
  slug: "leisure-sport-equipment-application",
  title: "Leisure & Sport Equipment Application",
  subtitle: "Equipment floater coverage for sports, leisure, production and musical equipment",
  tags: ["form:leisure-sport-equipment-application", "equipment"],
  source: "Anthony Insurance Forms — Leisure & Sport Equipment Application",
  successMessage:
    "Thank you! Your application has been submitted. An Anthony Insurance Services agent will review it and reach out shortly.",
  sections: [
    {
      id: "policy_holder",
      title: "Policy Holder Information",
      fields: [
        text("legal_business_name", "Full Legal Name of Policy Holder", {
          required: true,
          hint: "As it should appear on insurance policy (i.e name of your studio or business)",
          ghl: { standard: "companyName" },
        }),
        { type: "content", id: "contact_heading", variant: "subheading", title: "Contact Person Name" },
        text("first_name", "First Name", { required: true, width: "half", ghl: { standard: "firstName" } }),
        text("last_name", "Last Name", { required: true, width: "half", ghl: { standard: "lastName" } }),
        { type: "email", id: "email", label: "Email", required: true, width: "half", ghl: { standard: "email" } },
        { type: "tel", id: "phone", label: "Phone", required: true, width: "half", ghl: { standard: "phone" } },
        { type: "url", id: "website", label: "Website", placeholder: "www.example.com", width: "half", ghl: { standard: "website" } },
        { type: "tel", id: "fax", label: "Fax", width: "half" },
        { type: "content", id: "mailing_heading", variant: "subheading", title: "Address" },
        text("mailing_address", "Street Address", { required: true, ghl: { standard: "address1" } }),
        text("mailing_city", "City", { required: true, width: "half", ghl: { standard: "city" } }),
        { type: "select", id: "mailing_state", label: "State", options: US_STATES, required: true, width: "half", ghl: { standard: "state" } },
        text("mailing_country", "Country", { required: true, width: "half", placeholder: "United States" }),
        text("mailing_postal_code", "Postal Code", { required: true, width: "half", ghl: { standard: "postalCode" } }),
        yesNo("mailing_same_as_physical", "Is the MAILING address the same as the PHYSICAL Address?"),
        {
          type: "content",
          id: "physical_heading",
          variant: "subheading",
          title: "Physical Address",
          body: "Please enter the physical address of your business if different from the mailing address above",
          showIf: is("mailing_same_as_physical", "No"),
        },
        text("physical_address", "Street Address", { showIf: is("mailing_same_as_physical", "No") }),
        text("physical_address_2", "Address Line 2", { showIf: is("mailing_same_as_physical", "No") }),
        text("physical_city", "City", { width: "third", showIf: is("mailing_same_as_physical", "No") }),
        { type: "select", id: "physical_state", label: "State", options: US_STATES, width: "third", showIf: is("mailing_same_as_physical", "No") },
        text("physical_zip", "Zip Code", { width: "third", showIf: is("mailing_same_as_physical", "No") }),
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
        yesNo("single_item_150k", "Is any single item(s) valued at $150K or more?"),
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
      description: "1. Please complete. At least one limit is required below. Scheduled Items (Other Than Trailers)",
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
          id: "production_heading",
          variant: "subheading",
          title: "Owned Production Equipment",
          body: "Owned Production Equipment includes: Cameras, camera equipment, sound, audio visual, lighting and grip equipment, communications equipment, portable electric equipment, editing and projection equipment, office personal property, generators, mechanical effects equipment, props, sets, wardrobe, event equipment, theatrical equipment, computer equipment including desktops, laptops and monitors, and all similar personal property and related production and entertainment equipment.",
          showIf: isAnnual,
        },
        money("owned_production_value", "Owned Production Equipment", {
          hint: "Enter the cost to replace your production equipment in the event of a loss (Replacement Cost Value, including sales tax, of all Owned Production Equipment )",
          showIf: isAnnual,
        }),
        {
          type: "textarea",
          id: "owned_production_description",
          label: "Owned Production Equipment Description",
          hint: "Please provide description of your production equipment.",
          showIf: isAnnual,
        },
        {
          type: "content",
          id: "sports_heading",
          variant: "subheading",
          title: "Owned Sports, Leisure & Recreation Equipment",
          body: "Owned Sports, Leisure & Recreation Equipment includes: Sporting goods and equipment, gym and fitness equipment, business personal property, tenant improvements, sport event property, race timing machines, racing chips, banners, office personal property, ROTC related equipment, and any related Sports & Recreational equipment.",
          showIf: isAnnual,
        },
        money("owned_sports_value", "Owned Sports, Leisure & Recreational Equipment", {
          hint: "Enter the cost to replace your sports & recreational equipment in the event of a loss (Replacement Cost Value, including sales tax, of all Owned Sports Equipment )",
          showIf: isAnnual,
        }),
        {
          type: "textarea",
          id: "owned_sports_description",
          label: "Owned Sports, Leisure & Recreational Equipment Description",
          hint: "Please provide description of your sports and recreation equipment.",
          showIf: isAnnual,
        },
        {
          type: "content",
          id: "tenant_heading",
          variant: "subheading",
          title: "Tenant Improvements & Betterment",
          body: "Tenant Improvements & Betterment includes: Fixtures, alterations, installations, or additions that become part of a building that you do not own and cannot be legally removed. The tenant improvements and betterments were paid by you and had them installed or personally installed. This does not cover any landlord improvements to the rented space. MUST complete Tenant Betterments section.",
          showIf: isAnnual,
        },
        money("tenant_improvements_value", "Tenant Improvements & Betterments", {
          hint: "Enter the cost to replace your Tenant Improvements & Betterment in the event of a loss (Replacement Cost Value, including sales tax, of all Tenant Improvements and Betterment )",
          showIf: isAnnual,
        }),
        { type: "textarea", id: "tenant_improvements_description", label: "Tenant Improvements & Betterments Description", showIf: isAnnual },
        {
          type: "content",
          id: "bpp_heading",
          variant: "subheading",
          title: "Business Personal Property",
          body: "Business Personal Property includes: Office Furniture, lockers, rugs, lamps, telephones, laptops, computers, any other similar business personal property.",
          showIf: isAnnual,
        },
        money("business_personal_property_value", "Business Personal Property", {
          hint: "Enter the cost to replace your business personal property in the event of a loss (Replacement Cost Value, including sales tax, of all Business Personal Property )",
          showIf: isAnnual,
        }),
        { type: "textarea", id: "business_personal_property_description", label: "Business Personal Property Description", showIf: isAnnual },
        {
          type: "content",
          id: "musical_heading",
          variant: "subheading",
          title: "Owned Musical Instruments & Sound Equipment",
          body: "Owned Musical & Sound Equipment includes: Musical Instruments, sound equipment, vintage musical instruments, similar personal property, office personal property, and other related musical equipment",
          showIf: isAnnual,
        },
        money("owned_musical_value", "Owned Musical Instruments & Sound Equipment", {
          hint: "Musical Instruments, sound equipment, vintage musical instruments, similar personal property, office personal property, and other related musical equipment.",
          showIf: isAnnual,
        }),
        { type: "textarea", id: "owned_musical_description", label: "Owned Musical Instruments & Sound Equipment Description", showIf: isAnnual },
        {
          type: "content",
          id: "rented_heading",
          variant: "subheading",
          title: "Rented Equipment FROM Others",
          body: "Rented Equipment FROM others includes: Any of the above equipment classes rented for use not including tenant betterments and improvements.",
          showIf: isAnnual,
        },
        money("rented_from_others_value", "Rented Equipment from Others (Maximum value at any one time)", {
          hint: "Enter the replacement cost value of the Equipment Rented FROM others",
          showIf: isAnnual,
        }),
        { type: "textarea", id: "rented_from_others_description", label: "Rented Equipment from Others Description", showIf: isAnnual },

        { type: "content", id: "annual_questions_heading", variant: "subheading", title: "Please answer the following questions:", showIf: isAnnual },
        yesNo("single_item_5001", "For equipment you own, is any single item valued at $5,001 or more (replacement cost including sales tax)?", {
          required: false,
          showIf: isAnnual,
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
          showIf: (v) => isAnnual(v) && v.single_item_5001 === "Yes",
        },
        yesNo("custom_made_items", "Do you have any items that are cutom made?", { required: false, showIf: isAnnual }),

        {
          type: "content",
          id: "tenant_betterments_heading",
          variant: "subheading",
          title: "Tenant Betterments",
          body: "If you listed a limit in the Tenant Improvements & Betterments section in the above limit section of the application, you are required to answer the questions below.",
          showIf: isAnnual,
        },
        yesNo("requesting_tenant_improvements", "Are you requesting Tenant Improvements and Betterments Coverage?", {
          required: false,
          showIf: isAnnual,
        }),
        {
          type: "content",
          id: "tenant_betterments_notice",
          variant: "info",
          body: "Tenant Betterments require copies of work orders or material and labor receipts in order to be quoted. Please note that Tenant Betterments and Improvements is anything that is permanently fixed or attached to the building structure. If items can be removed without damaging the building structure, they would not be considered Tenant Betterments and Improvements.",
          showIf: isAnnual,
        },
        yesNo("insure_trailers", "Do you need to insure a Trailer(s)?", {
          required: false,
          hint: "If yes, please answer the additional trailer questions.",
          showIf: isAnnual,
        }),
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
        yesNo(
          "rent_to_others",
          "Do you rent any of your owned equipment to the sole custody of others (unaccompanied by you or your employees)?",
          { required: false, showIf: isAnnual },
        ),
        yesNo("voluntary_parting", "Would you like to add coverage for Voluntary Parting and False Pretense?", {
          required: false,
          tooltip: "This covers your equipment if the person/company renting or borrowing your equipment never returns it.",
          showIf: isAnnual,
        }),
        {
          type: "radio",
          id: "rental_reimbursement",
          label: "Rental Reimbursement Coverage - only available with Owned Equipment Coverage",
          options: opts("None", "$2,500", "$5,000", "$10,000", "$25,000"),
          tooltip: "If you have a covered claim, this coverage reimburses your rental fees for equipment rented to continue your business operations.",
          showIf: isAnnual,
        },
        {
          type: "radio",
          id: "continuing_rental_fees",
          label: "Continuing Rental Fees Coverage. Only available with Rented Equipment from Others Coverage",
          options: opts("None", "$2,500", "$5,000", "$10,000", "$25,000"),
          tooltip:
            "If you have a covered claim, this coverage reimburses your rental company for loss of rental income during your claim handling. This coverage has a 72 hour time deductible from the time the claim is reported in writing to the insurance agent or carrier.",
          showIf: isAnnual,
        },
        {
          type: "radio",
          id: "work_tools_clothing",
          label: "Work Tools and Clothing. Coverage options are per occurrence/per employee limits.",
          options: opts("None", "$1,000/$250", "$5,000/$500", "$10,000/$1,000"),
          tooltip: "This coverage is a separate limit for work related tools and clothing, such as work uniforms",
          showIf: isAnnual,
        },
        {
          type: "radio",
          id: "plate_glass",
          label: "Interior/Exterior Plate Glass Coverage.",
          options: opts("None", "$5,000 (additional premium $50.00)"),
          tooltip:
            "This covers exterior or interior plate glass (i.e. structural glass) installed by either you or your landlord at your business location. This DOES NOT cover Mirrors",
          showIf: isAnnual,
        },
        {
          type: "radio",
          id: "business_income",
          label: "Business Income and Extra Expense",
          options: opts("None", "Yes (Maximum Limit $50,000)"),
          tooltip:
            "If you have a covered claim, this coverage reimburses you after the waiting period for loss of income and expenses to keep your business running such as rent on another location. This coverage is location specific.",
          showIf: isAnnual,
        },
        { type: "content", id: "locked_vehicle_heading", variant: "subheading", title: "Locked Vehicle Warranty", showIf: isAnnual },
        yesNo(
          "remove_locked_vehicle_warranty",
          "This policy has a Locked Vehicle Warranty, which states there is NO coverage for equipment stolen from an Unlock vehicle. Do you wan to remove this warranty and thus add back coverage for equipment stolen from an Unlock vehicle for an additional 10% charge?",
          { required: false, showIf: isAnnual },
        ),
        yesNo("equipment_unattended_in_vehicle", "Will you ever leave any equipment in your vehicle unattended?", {
          required: false,
          showIf: isAnnual,
        }),
      ],
    },
    {
      id: "additional_info",
      title: "Additional Information",
      fields: [text("how_heard", "How did you hear about us?")],
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
        text("applicant_name", "Applicant Name", { width: "half" }),
        { type: "signature", id: "signature", label: "Applicant's Signature", required: true },
      ],
    },
  ],
};
