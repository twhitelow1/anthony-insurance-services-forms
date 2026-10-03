/*
 * Anthony Insurance Services — form embed.
 * Usage (on any website, WordPress, or a GHL funnel "custom code" block):
 *
 *   <div data-ais-form="sports-facility-application"></div>
 *   <script src="https://YOUR-DOMAIN/embed.js" async></script>
 *
 * The iframe auto-resizes to its content and scrolls the host page back to the
 * top of the form between steps. Optional: data-ais-redirect="https://…/thank-you"
 * sends the visitor to a thank-you page after a successful submission.
 */
(function () {
  var script = document.currentScript;
  var origin = new URL(script.src).origin;

  function mount(el) {
    if (el.dataset.aisMounted) return;
    el.dataset.aisMounted = "1";
    var iframe = document.createElement("iframe");
    iframe.src = origin + "/forms/" + encodeURIComponent(el.dataset.aisForm) + "?embed=1";
    iframe.title = el.dataset.aisTitle || "Insurance application";
    iframe.style.cssText = "width:100%;border:0;min-height:600px;display:block;";
    iframe.setAttribute("loading", "lazy");
    el.appendChild(iframe);

    window.addEventListener("message", function (e) {
      if (e.origin !== origin || e.source !== iframe.contentWindow || !e.data || e.data.source !== "ais-forms") return;
      if (e.data.type === "height") iframe.style.height = e.data.height + "px";
      if (e.data.type === "scrollTop") el.scrollIntoView({ behavior: "smooth", block: "start" });
      if (e.data.type === "submitted") {
        el.dispatchEvent(new CustomEvent("ais:submitted", { bubbles: true, detail: { form: e.data.form } }));
        if (el.dataset.aisRedirect) window.location.href = el.dataset.aisRedirect;
      }
    });
  }

  function init() {
    document.querySelectorAll("[data-ais-form]").forEach(mount);
  }
  if (document.readyState === "loading") document.addEventListener("DOMContentLoaded", init);
  else init();
})();
