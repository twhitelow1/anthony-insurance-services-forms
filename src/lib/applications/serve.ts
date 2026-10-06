import "server-only";

/** Serve a PDF privately: never cached, sandboxed, inline unless asked to download. */
export function pdfResponse(content: Uint8Array, filename: string, download = false) {
  return new Response(new Uint8Array(content), {
    headers: {
      "Content-Type": "application/pdf",
      "Content-Disposition": `${download ? "attachment" : "inline"}; filename="${filename.replace(/["\\\r\n]/g, "")}"`,
      "Cache-Control": "private, no-store",
      "X-Content-Type-Options": "nosniff",
      "Content-Security-Policy": "default-src 'none'; sandbox",
    },
  });
}
