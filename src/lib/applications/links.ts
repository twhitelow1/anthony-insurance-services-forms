/** Admin page listing every application for one email address. */
export const applicantPath = (email: string) => `/admin/applicants/${encodeURIComponent(email)}`;
