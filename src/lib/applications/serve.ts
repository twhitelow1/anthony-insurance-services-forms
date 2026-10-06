import "server-only";

/**
 * Serve a PDF privately: never cached, inline unless asked to download.
 * No CSP "sandbox" here: some browsers' built-in PDF viewers won't run in a
 * sandboxed page. These are PDFs this app generated, not uploads.
 */
export function pdfResponse(content: Uint8Array, filename: string, download = false) {
  return new Response(new Uint8Array(content), {
    headers: {
      "Content-Type": "application/pdf",
      "Content-Disposition": `${download ? "attachment" : "inline"}; filename="${filename.replace(/["\\\r\n]/g, "")}"`,
      "Cache-Control": "private, no-store",
      "X-Content-Type-Options": "nosniff",
    },
  });
}
