import "server-only";

/**
 * Serve a PDF privately: never cached, inline unless asked to download.
 * No CSP "sandbox" here: some browsers' built-in PDF viewers won't run in a
 * sandboxed page. These are PDFs this app generated, not uploads.
 */
/**
 * Serve an applicant's uploaded file. PDFs and images open in the browser; anything
 * else downloads. Sandboxed, since the applicant made it, not this app.
 */
export function uploadResponse(content: Uint8Array, filename: string, contentType: string, download = false) {
  const inline = !download && /^(application\/pdf|image\/(png|jpeg))$/.test(contentType);
  return new Response(new Uint8Array(content), {
    headers: {
      "Content-Type": contentType,
      "Content-Disposition": `${inline ? "inline" : "attachment"}; filename="${filename.replace(/["\\\r\n]/g, "")}"`,
      "Cache-Control": "private, no-store",
      "X-Content-Type-Options": "nosniff",
      ...(contentType === "application/pdf" ? {} : { "Content-Security-Policy": "sandbox" }),
    },
  });
}

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
