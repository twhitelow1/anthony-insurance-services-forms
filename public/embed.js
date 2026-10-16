/*
 * Anthony Insurance Services — form embed.
 * Usage (on any website, WordPress, or a Lead Alchemist funnel "custom code" block):
 *
 *   <div data-ais-form="sports-facility-application" data-ais-brand="ais"></div>
 *   <script src="https://YOUR-DOMAIN/embed.js" async></script>
 *
 * data-ais-brand: ais | dsi | masi (the website's look; defaults to the form's own site).
 * The iframe auto-resizes to its content and scrolls the host page back to the
 * top of the form between steps. Optional: data-ais-redirect="https://…/thank-you"
 * sends the visitor to a thank-you page after a successful submission, and the
 * element fires an "ais:submitted" event.
 *
 * Also accepted (one form, no div): <script src="…/embed.js" data-form="…" data-brand="…"></script>
 */
(function () {
  var script = document.currentScript;
  if (!script) return;
  var origin = new URL(script.src).origin;

  function mount(el) {
    if (el.dataset.aisMounted) return;
    el.dataset.aisMounted = "1";
    var brand = el.dataset.aisBrand;
    var iframe = document.createElement("iframe");
    iframe.src =
      origin + "/forms/" + encodeURIComponent(el.dataset.aisForm) + "?embed=1" + (brand ? "&brand=" + encodeURIComponent(brand) : "");
    iframe.title = el.dataset.aisTitle || "Insurance application";
    iframe.style.cssText = "width:100%;border:0;min-height:600px;display:block;overflow:hidden;";
    iframe.setAttribute("scrolling", "no");
    el.appendChild(iframe);

    window.addEventListener("message", function (e) {
      if (e.origin !== origin || e.source !== iframe.contentWindow || !e.data || e.data.source !== "ais-forms") return;
      if (e.data.type === "height" && e.data.height > 0) {
        iframe.style.minHeight = "0";
        iframe.style.height = e.data.height + "px";
      }
      if (e.data.type === "scrollTop" && el.getBoundingClientRect().top < 0) el.scrollIntoView({ behavior: "smooth", block: "start" });
      if (e.data.type === "submitted") {
        el.dispatchEvent(new CustomEvent("ais:submitted", { bubbles: true, detail: { form: e.data.form } }));
        if (el.dataset.aisRedirect) window.location.href = el.dataset.aisRedirect;
      }
    });
  }

  // One-tag form: <script data-form="…" data-brand="…"> mounts right where the script is.
  if (script.dataset.form) {
    var holder = document.createElement("div");
    holder.dataset.aisForm = script.dataset.form;
    if (script.dataset.brand) holder.dataset.aisBrand = script.dataset.brand;
    if (script.dataset.redirect) holder.dataset.aisRedirect = script.dataset.redirect;
    if (script.dataset.title) holder.dataset.aisTitle = script.dataset.title;
    script.parentNode.insertBefore(holder, script);
  }

  function init() {
    document.querySelectorAll("[data-ais-form]").forEach(mount);
  }
  if (document.readyState === "loading") document.addEventListener("DOMContentLoaded", init);
  else init();
})();
