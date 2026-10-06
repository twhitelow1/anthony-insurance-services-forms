import { is, isYes, money, num, opts, text, US_STATES, yesNo } from "@/lib/forms/helpers";
import type { FormDefinition } from "@/lib/forms/types";

/**
 * Aerial studio liability application. Transcribed from Lead Alchemist form
 * YK2al1vcLOnPCt3qW1kZ, which dancestudioinsurance.com embeds on both
 * /aerial-dance-studio-form/ and /aerial-yoga-studio-form/; the two web forms
 * share these questions under their own slug and title.
 *
 * Answers are stored in the app's database. Only fields with `ghl.standard`
 * are copied to the GoHighLevel contact.
 */

const notSameAsMailing = is("mailing_same_as_physical", "No");
const hasSecondLocation = isYes("multiple_locations");

type Variant = Pick<FormDefinition, "slug" | "title" | "subtitle" | "source">;

const aerialStudioForm = (meta: Variant): FormDefinition => ({
  ...meta,
  tags: [`form:${meta.slug}`, "dance-fitness"],
  successMessage:
    "Thank you! Your application has been submitted. An Anthony Insurance Services agent will review it and reach out shortly.",
  sections: [
    {
      id: "policyholder",
      title: "Policyholder Details",
      fields: [
        text("policy_holder_name", "Name of Policy Holder", { required: true }),
        text("legal_business_name", "Name of Business or Studio", {
          required: true,
          tooltip: "Enter the legal name of the studio or business.",
          ghl: { standard: "companyName" },
        }),
        {
          type: "content",
          id: "mailing_heading",
          variant: "subheading",
          title: "Mailing Address",
          body: "This is the address that will appear on the policy. If the physical address of the studio is different or if you operate out of multiple locations, you can add the physical locations below.",
        },
        text("mailing_address", "Street Address", { required: true, ghl: { standard: "address1" } }),
        text("mailing_address_line_2", "Address Line 2"),
        text("mailing_city", "City", { required: true, width: "third", ghl: { standard: "city" } }),
        { type: "select", id: "mailing_state", label: "State", options: US_STATES, required: true, width: "third", ghl: { standard: "state" } },
        text("mailing_postal_code", "Postal Code", { required: true, width: "third", ghl: { standard: "postalCode" } }),
        text("mailing_country", "Country", { width: "half" }),
        { type: "content", id: "contact_heading", variant: "subheading", title: "Contact Person" },
        text("first_name", "First Name", { required: true, width: "half", ghl: { standard: "firstName" } }),
        text("last_name", "Last Name", { required: true, width: "half", ghl: { standard: "lastName" } }),
        { type: "tel", id: "phone", label: "Phone", required: true, width: "half", ghl: { standard: "phone" } },
        { type: "email", id: "email", label: "Email", required: true, width: "half", ghl: { standard: "email" } },
        { type: "url", id: "website", label: "Website", placeholder: "www.example.com", ghl: { standard: "website" } },
        {
          type: "date",
          id: "requested_effective_date",
          label: "Desired Effective Date of Coverage (12 months of coverage is provided)",
          required: true,
          width: "half",
        },
        {
          type: "textarea",
          id: "class_types",
          label: "What types of classes are taught? Please be specific.",
          required: true,
          tooltip:
            "List all the class offerings (i.e. Dance, mat Pilates, Aerial Yoga, mat yoga, Zumba, etc.) NOTE: Martial Arts, MMA training, Boxing (other than Cardio Kickboxing), sports training and health club facilities are NOT eligible under this program.",
        },
        yesNo(
          "health_club_services",
          "Does your studio offer or provide any of the following: tanning beds, spa/massage, sauna, sports medicine or physical therapy, professional athlete training, daycare facilities, 24 hour access, unsupervised and/or keyed access?",
          { tooltip: "If your answer is Yes, please visit the HEALTH CLUB application." },
        ),
        {
          type: "content",
          id: "health_club_notice",
          variant: "notice",
          body: "If your answer is Yes, please visit the HEALTH CLUB application: https://dancestudioinsurance.com/insurance-for-health-clubs/",
          showIf: isYes("health_club_services"),
        },
        yesNo("mailing_same_as_physical", "Is the mailing address the same as your studio location (i.e. physical address)?"),
        {
          type: "content",
          id: "physical_heading",
          variant: "subheading",
          title: "Physical Address",
          body: "Please enter the physical address of your studio.",
          showIf: notSameAsMailing,
        },
        text("physical_address", "Street Address", { showIf: notSameAsMailing }),
        text("physical_address_line_2", "Address Line 2", { showIf: notSameAsMailing }),
        text("physical_city", "City", { width: "third", showIf: notSameAsMailing }),
        { type: "select", id: "physical_state", label: "State", options: US_STATES, width: "third", showIf: notSameAsMailing },
        text("physical_zip", "ZIP Code", { width: "third", showIf: notSameAsMailing }),
        yesNo("multiple_locations", "Do you have multiple locations?", {
          tooltip: "Please note that all covered locations must be covered under the same Tax ID / Business Entity",
        }),
        {
          type: "content",
          id: "physical_2_heading",
          variant: "subheading",
          title: "Physical Address No. 2",
          body: "Enter a second physical location.",
          showIf: hasSecondLocation,
        },
        text("physical_2_address", "Street Address", { showIf: hasSecondLocation }),
        text("physical_2_address_line_2", "Address Line 2", { showIf: hasSecondLocation }),
        text("physical_2_city", "City", { width: "third", showIf: hasSecondLocation }),
        { type: "select", id: "physical_2_state", label: "State", options: US_STATES, width: "third", showIf: hasSecondLocation },
        text("physical_2_zip", "ZIP Code", { width: "third", showIf: hasSecondLocation }),
        yesNo("coverage_cancelled", "Has your past liability coverage been cancelled in any way in the last three years?"),
        {
          type: "textarea",
          id: "coverage_cancelled_explanation",
          label: "If your liability policy has been cancelled, please explain and be specific.",
          showIf: isYes("coverage_cancelled"),
        },
        yesNo("risk_management_plan", "Do you agree to have a Risk Management Plan in place during the coverage period of your policy?", {
          tooltip:
            "A risk management plan includes your organization's written safety procedures—such as an emergency action plan, weather-incident steps, injury/incident report forms, and posted safety rules. You should have these in place or be ready to adopt them at the start of the policy.",
        }),
      ],
    },
    {
      id: "waiver",
      title: "Waiver Requirement",
      fields: [
        yesNo("waiver_system", "Do you have a participant waiver and release system in place?", {
          tooltip:
            "Each school or studio must implement a Release and Waiver of Liability and Indemnity Agreement for all students and staff members. Unintentional error on your part in securing Waiver and Release forms shall not void your coverage in the event of an occurrence to a student or staff member. However, your failure to maintain an adequate system to regularly secure Waiver and Release forms shall void your coverage in the event of an occurrence to a student or staff member.",
        }),
        {
          // The source offers "Upload now" or "Email later"; this app doesn't take uploads yet.
          type: "content",
          id: "waiver_email",
          variant: "info",
          title: "Waiver",
          body: "Please email a copy of the studio's waiver form to Melanie@AnthonyInsuranceServices.com after submitting the application.",
        },
      ],
    },
    {
      id: "premium",
      title: "Premium and Coverage Selections",
      fields: [
        num("participants_busiest_month", "Total Number of Participants in the Busiest Month of the Year for all Locations Combined", {
          required: true,
          min: 1,
          tooltip:
            "Please provide the best estimate, counting each participant only once. So if someone comes 3x per week, you would only account for them 1 time.",
        }),
        {
          type: "select",
          id: "general_aggregate_limit",
          label: "Select General Aggregate Limit",
          // Option list was not visible in the source; these match the same program's
          // General Liability Aggregate choices on its PDF application.
          options: opts("$1,000,000", "$2,000,000", "$3,000,000", "$4,000,000", "$5,000,000"),
          required: true,
          width: "half",
          tooltip:
            "All policies Include $1,000,000.00 Limit Per Occurrence Liability Policy. Please select the general aggregate limit.",
        },
      ],
    },
    {
      id: "aerial_underwriting",
      title: "Aerial Underwriting Questions",
      description: "Please answer the questions below for aerial activities offered at your studio.",
      fields: [
        text("aerial_max_height", "What is the maximum height of aerial activities off the ground?", {
          required: true,
          width: "half",
          tooltip: "The maximum height allowed off the ground is 12 feet. Anything over 12 feet in height, off the ground, will be declined.",
        }),
        {
          type: "textarea",
          id: "aerial_safety_measures",
          label: "What safety measures are in place, such as the use of mats or pads?",
          required: true,
        },
        money("annual_gross_receipts", "Provide the estimated annual gross receipts for your studio", {
          required: true,
          width: "half",
          tooltip:
            "Gross receipts are the total amounts the studio received from all sources during its annual accounting period, without subtracting any costs or expense",
        }),
        text("alcohol_on_site", "Is alcohol served or is BYOB allowed on site?"),
        {
          type: "textarea",
          id: "loss_runs",
          label: "Please provide carrier produced loss runs at least 3 years",
          tooltip:
            "If you are a renewal client, please note that in the field below and the underwriter will review. If you are a NEW applicant and have had studio insurance before, please ask your previous or current insurer for your Loss Runs report and they will be able to email it to you. If you are a NEW applicant, and have not had insurance before, please indicate that in the space below.",
        },
        { type: "content", id: "optional_coverages_heading", variant: "subheading", title: "Optional Coverage(s)" },
        {
          type: "radio",
          id: "hired_non_owned_auto",
          label: "Add Optional Hired and non-owned automobile liability coverage?",
          options: opts(
            "No",
            "$150,000 Limit ($225 premium)",
            "$500,000 Limit ($500 premium)",
            "$1,000,000 Limit ($850 premium and our receipt and approval of our Hired/Non-owned Auto supplemental application. Please contact me if you would like this application.)",
          ),
          required: true,
          tooltip:
            "This liability coverage provides protection for rented, borrowed, hired and other non-owned vehicles driven on studio business. This does NOT cover comp or collision claims. This covers claims arising from bodily injury or property damage (to others) caused by a hired or non-owned vehicle.",
        },
        {
          type: "radio",
          id: "sexual_abuse_molestation",
          label: "Add $100,000 Sexual Abuse & Molestation Liability coverage?",
          options: opts("No", "Yes (Additional Premium: $1,000.00)"),
          required: true,
          tooltip: "Liability coverage is provided for claims arising out of alleged sexual abuse and/or molestation.",
        },
        yesNo("equipment_coverage", "Equipment Coverage", {
          required: false,
          tooltip:
            "To add coverage for the studio's contents and equipment, select Yes, and we will email you an application to request a quote to the email above. This Inland Marine insurance product provides coverage for your equipment and contents up to the specified limit.",
        }),
      ],
    },
    {
      id: "signature",
      title: "Additional Information",
      fields: [
        text("how_did_you_hear", "How did you hear about us?", { required: true }),
        {
          type: "content",
          id: "fraud_warning",
          variant: "notice",
          body: "Any person who knowingly presents a false or fraudulent claim for payment of a loss or benefit or knowingly provides false information in an application for insurance may be guilty of a crime and may be subject to civil fines and criminal penalties. I certify that the above information is true and coverage is not in force until accepted by Anthony Insurance Services, Inc. Coverage is subject to the receipt of payment of the required premium by Anthony Insurance Services, Inc.",
        },
        { type: "signature", id: "signature", label: "Authorized Electronic Signature", required: true },
        text("signer_title", "Title or Position", { required: true, width: "half" }),
        {
          type: "checkboxes",
          id: "terms_conditions",
          label: "Terms & Conditions",
          options: [{ label: "I have read and agree with the Terms & Conditions.", value: "Yes" }],
          required: true,
          hint: "https://dancestudioinsurance.com/terms-conditions/",
        },
      ],
    },
  ],
});

export const aerialYogaStudioApplication = aerialStudioForm({
  slug: "aerial-yoga-studio-application",
  title: "Aerial Yoga Studio Application",
  subtitle: "Aerial studio liability for aerial yoga, yoga and group fitness studios",
  source: "Anthony Insurance Forms — Aerial Yoga Studio Application",
});

export const aerialDanceStudioApplication = aerialStudioForm({
  slug: "aerial-dance-studio-application",
  title: "Aerial Dance Studio Application",
  subtitle: "Aerial studio liability for aerial dance and dance studios",
  source: "Anthony Insurance Forms — Aerial Dance Studio Application",
});
