import "server-only";
import { addNote, applicationDetails, changeStatus, describeForm, findApplications, listForms, startApplication, STATUS_OPTIONS } from "./service";

/**
 * The AIS Connect tools, described for an AI assistant (MCP "tools"). Each runs as the API key that
 * called it; everything it changes is logged on the application with "api:<key name>".
 */
export interface ApiTool {
  name: string;
  description: string;
  inputSchema: Record<string, unknown>;
  readOnly: boolean;
  run(args: Record<string, unknown>, actor: string): Promise<unknown>;
}

const obj = (properties: Record<string, unknown>, required: string[] = []) => ({ type: "object", properties, required, additionalProperties: false });
const ref = { type: "string", description: "The application's reference (e.g. AIS-98D4-2EQM) or id." };

export const TOOLS: ApiTool[] = [
  {
    name: "list_forms",
    description: "List Anthony Insurance's online application forms (form id, title, website). Use it to pick the right form before describe_form.",
    inputSchema: obj({}),
    readOnly: true,
    run: async () => ({ forms: listForms() }),
  },
  {
    name: "describe_form",
    description:
      "The questions of one form, section by section, with their ids, types, options and which are required. Read it before start_application so you ask for and send the right answers.",
    inputSchema: obj({ form: { type: "string", description: "The form id from list_forms, e.g. larp-event-application." } }, ["form"]),
    readOnly: true,
    run: async (a) => describeForm(String(a.form ?? "")),
  },
  {
    name: "start_application",
    description:
      "Start an application for someone with the answers you have (question id → answer; the applicant's email is required). AIS Connect saves it and emails the applicant a private link to check it, answer anything still needed and sign it themselves; it is not submitted until they sign. Returns the link and the questions still needed. Set sendEmail to false to get the link without emailing it.",
    inputSchema: obj(
      {
        form: { type: "string", description: "The form id from list_forms." },
        answers: { type: "object", description: "Question id → answer (text, or a list for checkboxes). Include email, first_name, last_name.", additionalProperties: true },
        sendEmail: { type: "boolean", description: "Email the applicant the link (default true)." },
      },
      ["form", "answers"],
    ),
    readOnly: false,
    run: (a, actor) => startApplication(a, actor),
  },
  {
    name: "find_applications",
    description:
      "Find submitted applications by the applicant's email, their Lead Alchemist contact id, an application reference, or a name/business/answer search. Returns each one's status, dates and links (newest first).",
    inputSchema: obj({
      email: { type: "string" },
      leadAlchemistContactId: { type: "string", description: "The Lead Alchemist contact id." },
      reference: { type: "string", description: "e.g. AIS-98D4-2EQM" },
      search: { type: "string", description: "Words to search names, businesses and answers." },
      limit: { type: "number", description: "Up to 50 (default 10)." },
    }),
    readOnly: true,
    run: (a) => findApplications(a),
  },
  {
    name: "get_application",
    description: "One application in full: status, every answer, links to it and its PDF, and its recent activity.",
    inputSchema: obj({ application: ref }, ["application"]),
    readOnly: true,
    run: (a) => applicationDetails(a.application),
  },
  {
    name: "set_application_status",
    description: `Change an application's status. Statuses: ${STATUS_OPTIONS.map((s) => `${s.status} (${s.label})`).join(", ")}. The applicant is emailed about it only when notifyApplicant is true. Logged on the application.`,
    inputSchema: obj(
      {
        application: ref,
        status: { type: "string", enum: STATUS_OPTIONS.map((s) => s.status) },
        note: { type: "string", description: "Why, shown with the change." },
        notifyApplicant: { type: "boolean", description: "Email the applicant about the new status (default false)." },
      },
      ["application", "status"],
    ),
    readOnly: false,
    run: (a, actor) => changeStatus(a, actor),
  },
  {
    name: "add_application_note",
    description: "Add a note to an application's activity log. Staff-only unless clientVisible is true (then the applicant sees it in their portal).",
    inputSchema: obj({ application: ref, note: { type: "string" }, clientVisible: { type: "boolean", description: "Show it to the applicant (default false)." } }, ["application", "note"]),
    readOnly: false,
    run: (a, actor) => addNote(a, actor),
  },
];
