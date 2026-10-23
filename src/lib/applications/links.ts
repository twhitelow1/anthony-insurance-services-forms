/** Old admin page for one email; it now redirects to the client's page. Prefer clientPath. */
export const applicantPath = (email: string) => `/admin/applicants/${encodeURIComponent(email)}`;

/** The client's page (all of their applications). Falls back to the email redirect for rows not linked to a client yet. */
export const clientPath = (clientId: string | null | undefined, email: string) =>
  clientId ? `/admin/clients/${clientId}` : applicantPath(email);
