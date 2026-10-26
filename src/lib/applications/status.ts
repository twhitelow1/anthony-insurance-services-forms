/** Application lifecycle. Labels/descriptions are what the client sees in their portal. */
export const STATUSES = {
  received: {
    label: "Received",
    description: "We've received your application and it's in line for review.",
    tone: "neutral",
  },
  in_review: {
    label: "In review",
    description: "An agent is reviewing your application.",
    tone: "active",
  },
  info_needed: {
    label: "Information needed",
    description: "We need a little more information from you. Your agent will reach out, or check the notes below.",
    tone: "warning",
  },
  submitted_to_carrier: {
    label: "Submitted to carrier",
    description: "Your application has been sent to the insurance carrier for underwriting.",
    tone: "active",
  },
  quoted: {
    label: "Quote ready",
    description: "A quote is ready. Your agent will review it with you.",
    tone: "success",
  },
  bound: {
    label: "Coverage bound",
    description: "Your coverage is in place.",
    tone: "success",
  },
  declined: {
    label: "Declined",
    description: "The carrier was unable to offer coverage. Your agent will discuss other options with you.",
    tone: "danger",
  },
  withdrawn: {
    label: "Withdrawn",
    description: "This application was withdrawn.",
    tone: "neutral",
  },
} as const;

export type ApplicationStatus = keyof typeof STATUSES;
export const STATUS_KEYS = Object.keys(STATUSES) as ApplicationStatus[];
export const isStatus = (s: unknown): s is ApplicationStatus => typeof s === "string" && s in STATUSES;
