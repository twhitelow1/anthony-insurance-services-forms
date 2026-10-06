import { includes, isYes, money, num, opts, text, US_STATES, yesNo } from "@/lib/forms/helpers";
import type { Field, FormDefinition } from "@/lib/forms/types";

/**
 * Aerial Instructor — General Liability application.
 * Transcribed from the Lead Alchemist form FxLHdygRPQTmDs3jxH0y (older website version:
 * dancestudioinsurance.com/aerial-yoga-instructor-form/), plus client-requested Additional Insured fields.
 */

function additionalInsuredFields(n: number): Field[] {
  return [
    { type: "content", id: `ai_${n}_heading`, variant: "subheading", title: `Additional Insured #${n}` },
    text(`ai_${n}_name`, "Name"),
    text(`ai_${n}_address`, "Address"),
    text(`ai_${n}_city`, "City", { width: "third" }),
    { type: "select", id: `ai_${n}_state`, label: "State", options: US_STATES, width: "third" },
    text(`ai_${n}_zip`, "Zip Code", { width: "third" }),
  ];
}

export const aerialInstructorApplication: FormDefinition = {
  slug: "aerial-instructor-application",
  title: "Aerial Instructor Application",
  subtitle: "Annual General Liability coverage for aerial instructors",
  tags: ["form:aerial-instructor-application", "dance-fitness"],
  source: "Anthony Insurance Forms — Aerial Instructor Application",
  successMessage:
    "Thank you! Your application has been submitted. An Anthony Insurance Services agent will review it and reach out shortly.",
  sections: [
    {
      id: "policyholder",
      title: "Policyholder Details",
      fields: [
        { type: "content", id: "name_heading", variant: "subheading", title: "Full Legal name of Instructor" },
        text("first_name", "First Name", { required: true, width: "half", ghl: { standard: "firstName" } }),
        text("last_name", "Last Name", { required: true, width: "half", ghl: { standard: "lastName" } }),
        yesNo("age_18_or_older", "Are you 18 or older?", {
          tooltip: "You are NOT eligible for this coverage if you are under 18",
        }),
        { type: "content", id: "mailing_heading", variant: "subheading", title: "Address" },
        text("mailing_address", "Street Address", { required: true, ghl: { standard: "address1" } }),
        text("mailing_city", "City", { required: true, width: "third", ghl: { standard: "city" } }),
        { type: "select", id: "mailing_state", label: "State", options: US_STATES, required: true, width: "third", ghl: { standard: "state" } },
        text("mailing_postal_code", "ZIP Code", { required: true, width: "third", ghl: { standard: "postalCode" } }),
        { type: "tel", id: "phone", label: "Phone", required: true, width: "half", ghl: { standard: "phone" } },
        { type: "email", id: "email", label: "Email", required: true, width: "half", ghl: { standard: "email" } },
        { type: "url", id: "website", label: "Website", placeholder: "www.example.com", ghl: { standard: "website" } },
        {
          type: "date",
          id: "requested_effective_date",
          label: "Desired Effective Date of Coverage (12 months of coverage is provided)",
          required: true,
          width: "half",
          tooltip:
            "Policy will become effective on the Requested Effective Date if (a) all required information is provided and (b) the Company has received the initial premium on or before that date. Coverage is issued on an annual basis.",
        },
        yesNo("coverage_cancelled", "Has your past liability coverage been cancelled in any way in the last three years?"),
        {
          type: "textarea",
          id: "coverage_cancelled_details",
          label: "If your liability policy has been cancelled, please explain and be specific.",
          showIf: isYes("coverage_cancelled"),
        },
        yesNo("risk_management_plan", "Do you agree to have a Risk Management Plan in place during the coverage period of your policy?", {
          tooltip:
            "Risk Management is a method for identifying risks and developing and implementing programs to first, prevent or reduce accidents, injuries or loss and second, to protect the organization. You have agreed to have a Risk Management Plan in place during the coverage period of your policy. If you do not yet have such a plan in place, see our Guide to Risk Management: https://securedanceinsurance.com/DanceStudioInsurance/GuideToRiskManagement",
        }),
      ],
    },
    {
      id: "waiver",
      title: "Waiver Requirement",
      fields: [
        {
          type: "content",
          id: "waiver_requirement",
          variant: "notice",
          title: "Waiver Requirement",
          body: "Each INSTRUCTOR must implement a Release and Waiver of Liability and Indemnity Agreement for all students and staff members. Unintentional error on your part in securing Waiver and Release forms shall not void your coverage in the event of an occurrence to a student or staff member. However, your failure to maintain an adequate system to regularly secure Waiver and Release forms shall void your coverage in the event of an occurrence to a student or staff member.",
        },
        {
          type: "radio",
          id: "waiver_agree",
          label: "Do you agree to use a waiver or have a waiver and release system in place at the time coverage is bound?",
          options: opts("Yes"),
          required: true,
        },
        {
          type: "content",
          id: "waiver_upload_notice",
          variant: "info",
          title: "Waiver Upload",
          body: "Please send any waivers used. If you can work at multiple locations, and don't have your own individual waiver, please send each waiver. You can email them to melanie@anthonyinsuranceservices.com once the application is submitted.",
        },
      ],
    },
    {
      id: "experience",
      title: "Instructor Experience & Operations",
      fields: [
        yesNo("certified_instructor", "Are you a certified instructor?", { required: false }),
        {
          type: "checkboxes",
          id: "training_certifications",
          label: "What training certifications do you have?",
          options: opts(
            "AAAI-ISMA", "AAPTE", "ACE", "ACSM", "AFFA", "AFPA", "CI", "HFPA", "IART", "IFPA", "IPTA", "ISFD", "ISFTA",
            "ISSA", "NABF", "NAFC", "NAFTA", "NASM", "NCCPT", "NCSF", "NESTA", "NETA", "NFPT", "NSCA", "NSPA", "PFIT",
            "SIEP", "USCI", "WITS", "OTHER",
          ),
          showIf: isYes("certified_instructor"),
        },
        {
          type: "textarea",
          id: "other_certification",
          label: "Other Certification (200 training hours required)",
          hint: "Please describe in detail",
          showIf: includes("training_certifications", "OTHER"),
        },
        {
          type: "content",
          id: "certificates_upload_notice",
          variant: "info",
          body: "Please email copies of training certificates (if any) to melanie@anthonyinsuranceservices.com once the application is submitted.",
          showIf: isYes("certified_instructor"),
        },
        num("years_experience", "Years of accredited experience?", { required: true, width: "half" }),
        num("annual_clients", "Annual number of clients", {
          required: true,
          width: "half",
          tooltip: "Provide the estimated number of clients you teach/instruct over the course of the year, counting each client/student once.",
        }),
        {
          type: "checkboxes",
          id: "instructor_types",
          label: "Type of Instructor (check all that apply)",
          options: opts(
            "Aerobics", "Aerial", "Aquatic Exercise", "Barre", "Cardio kickboxing", "Children's Fitness Programs", "Dance",
            "Dancercise", "Excercise", "Golf Teacher/Instructor", "Group Fitness", "Gyrotonic", "Personal Training", "Pilates",
            "Pole", "Spinning", "Stoller Strides", "Strength", "Stretching", "Tai Chi", "Yoga", "Zumba", "Other",
          ),
          required: true,
        },
        {
          type: "textarea",
          id: "other_instructor_type",
          label: "Other Instructor type",
          hint: "Please describe in detail",
          showIf: includes("instructor_types", "Other"),
        },
        { type: "textarea", id: "instructor_activities", label: "Description of Instructor activities:", required: true },
        {
          type: "textarea",
          id: "training_locations",
          label: "Location(s) of training:",
          required: true,
          tooltip: "Please list the various locations you will instructor at . Additional insureds can be added prior to binding coverage.",
        },
        {
          type: "radio",
          id: "locations_carry_liability",
          label: "Does the location(s) carry liability insurance?",
          options: opts("Yes", "No", "Unknown"),
          required: true,
        },
      ],
    },
    {
      id: "coverage",
      title: "Premium and Coverage Selections",
      fields: [
        // The source renders this as a dropdown whose options could not be read; collected as free text.
        text("general_aggregate_limit", "Select General Aggregate Limit", {
          required: true,
          width: "half",
          tooltip: "$1,000,000.00 Limit Per Occurrence Liability Policy. Please select the general aggregate limit.",
        }),
      ],
    },
    {
      id: "aerial",
      title: "Aerial Underwriting Questions",
      description: "Please answer the questions below as they apply to your aerial instructor operations.",
      fields: [
        text("max_height", "Provide the maximum height someone will be in the equipment, off the ground", {
          tooltip:
            "the maximum height allowed for aerial activities is 12 feet off the ground. If you go higher than 12 feet off the ground, you will not be eligible for coverage.",
        }),
        { type: "textarea", id: "aerial_activities_description", label: "Provide a description of the aerial activities:", required: true },
        {
          type: "textarea",
          id: "safety_measures",
          label: "What type of safety measures are in place, such as the use of mats or pads?",
          required: true,
          tooltip:
            "If you instruct at multiple locations, the safety measures should be listed for each location. You can list the location below and the safety measures below.",
        },
        money("annual_instructor_revenue", "What is your annual instructor revenue?", {
          required: true,
          width: "half",
          tooltip: "Provide the annual revenue you make from teaching/instructing.",
        }),
        yesNo(
          "alcohol",
          "Do you teach at a location that allows alcohol? Do you allow alcohol to be consumed during the classes you teach?",
        ),
        {
          type: "textarea",
          id: "alcohol_details",
          label: "Please describe any type of alcohol related activities with regards to your instruction. If the studio you teach at allows BYOB and/or serves alcohol, please describe below.",
        },
        {
          type: "textarea",
          id: "loss_runs",
          label: "Please provide carrier produced loss runs at least 3 years",
          required: true,
          tooltip:
            "If you are a renewal client, please note that in the field below and the underwriter will review. If you are a NEW applicant and have had instructor insurance before, please ask your previous or current insurer for your Loss Runs report and they will be able to email it to you. If you are a NEW applicant, and have not had insurance before, please indicate that in the space below.",
        },
      ],
    },
    {
      id: "optional_coverages",
      title: "Optional Coverages",
      fields: [
        {
          type: "radio",
          id: "hnoa",
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
      ],
    },
    {
      id: "additional_insured",
      title: "Additional Insured",
      description: "Leave blank if you don't need an additional insured.",
      fields: [1, 2, 3].flatMap(additionalInsuredFields),
    },
    {
      id: "additional_info",
      title: "Additional Information",
      fields: [text("how_heard", "How did you hear about us?", { required: true })],
    },
    {
      id: "signature",
      title: "Authorized Electronic Signature",
      fields: [
        {
          type: "content",
          id: "representations",
          variant: "notice",
          body: "Any person who knowingly presents a false or fraudulent claim for payment of a loss or benefit or knowingly provides false information in an application for insurance may be guilty of a crime and may be subject to civil fines and criminal penalties. I certify that the above information is true and coverage is not in force until accepted by Anthony Insurance Services, Inc. Coverage is subject to the receipt of payment of the required premium by Anthony Insurance Services, Inc.",
        },
        { type: "signature", id: "signature", label: "Authorized Electronic Signature", required: true },
        {
          type: "content",
          id: "terms_notice",
          variant: "notice",
          title: "Terms & Conditions",
          body: [
            "Each INSTRUCTOR must implement a Release and Waiver of Liability and Indemnity Agreement for all students and staff members. Unintentional error on your part in securing Waiver and Release forms shall not void your coverage in the event of an occurrence to a student or staff member. However, your failure to maintain an adequate system to regularly secure Waiver and Release forms shall void your coverage in the event of an occurrence to a student or staff member.",
          ],
        },
        {
          type: "checkboxes",
          id: "terms_conditions",
          label: "I have read and agree with the Terms & Conditions.",
          options: opts("Yes"),
          required: true,
        },
      ],
    },
  ],
};
